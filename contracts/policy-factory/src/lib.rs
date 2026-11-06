use near_sdk::json_types::{Base64VecU8, U64, U128};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, env, ext_contract, near, require,
};

const STATE_VERSION: u16 = 1;
const MAX_APPROVERS: usize = 16;
const MAX_INSTANCES: u32 = 10_000;
const MAX_PAGE_SIZE: u64 = 50;
const MIN_DEPLOYMENT_DEPOSIT_YOCTO: u128 = 250_000_000_000_000_000_000_000;
const MIN_INSTANCE_BALANCE_YOCTO: u128 = 200_000_000_000_000_000_000_000;
const POLICY_INIT_GAS: Gas = Gas::from_tgas(50);
const CALLBACK_GAS: Gas = Gas::from_tgas(25);
const MAX_CALLBACK_RESULT_BYTES: usize = 1_024;

type Digest = [u8; 32];

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeploymentStatus {
    Pending,
    Active,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
struct PolicyInstance {
    account_id: AccountId,
    requested_by: AccountId,
    attached_deposit: NearToken,
    requested_at_ns: u64,
    status: DeploymentStatus,
}

#[near(serializers = [json])]
pub struct PolicyInstanceView {
    pub organization_commitment: Base64VecU8,
    pub account_id: AccountId,
    pub requested_by: AccountId,
    pub attached_deposit: U128,
    pub requested_at_ns: U64,
    pub status: DeploymentStatus,
}

#[near(serializers = [json])]
struct PolicyInitArgs {
    controller: AccountId,
    organization_commitment: Base64VecU8,
    policy_digest: Base64VecU8,
    approvers: Vec<AccountId>,
    approval_threshold: u16,
}

#[ext_contract(ext_self)]
#[allow(dead_code)]
trait ExtSelf {
    fn on_create_policy_instance(&mut self, organization_commitment: Base64VecU8) -> bool;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    state_version: u16,
    provisioner: AccountId,
    policy_code_hash: Digest,
    instances: IterableMap<Vec<u8>, PolicyInstance>,
    account_owners: LookupMap<AccountId, Digest>,
}

#[near]
impl Contract {
    #[init]
    pub fn init(provisioner: AccountId, policy_code_hash: Base64VecU8) -> Self {
        let current = env::current_account_id();
        require!(
            current.as_str().len() <= 31,
            "COF_FAC_001: factory account ID is too long"
        );
        require!(
            provisioner != current,
            "COF_FAC_024: provisioner must be an external account"
        );
        Self {
            state_version: STATE_VERSION,
            provisioner,
            policy_code_hash: fixed_digest(
                policy_code_hash,
                "COF_FAC_002: policy code hash must be 32 bytes",
            ),
            instances: IterableMap::new(b"instances".to_vec()),
            account_owners: LookupMap::new(b"account-owners".to_vec()),
        }
    }

    #[payable]
    pub fn create_policy_instance(
        &mut self,
        organization_commitment: Base64VecU8,
        controller: AccountId,
        policy_digest: Base64VecU8,
        approvers: Vec<AccountId>,
        approval_threshold: u16,
    ) -> Promise {
        require!(
            env::predecessor_account_id() == self.provisioner,
            "COF_FAC_023: only the provisioner can create an instance"
        );
        require!(
            self.instances.len() < MAX_INSTANCES,
            "COF_FAC_003: instance capacity reached"
        );
        let organization = fixed_digest(
            organization_commitment,
            "COF_FAC_004: organization commitment must be 32 bytes",
        );
        let policy = fixed_digest(policy_digest, "COF_FAC_005: policy digest must be 32 bytes");
        let approvers = validated_approvers(approvers, approval_threshold);
        require!(
            approvers.binary_search(&controller).is_ok(),
            "COF_FAC_006: controller must be an approver"
        );
        require!(
            self.instances.get(organization.as_slice()).is_none(),
            "COF_FAC_007: organization instance already exists"
        );

        let attached = env::attached_deposit();
        require!(
            attached >= NearToken::from_yoctonear(MIN_DEPLOYMENT_DEPOSIT_YOCTO),
            "COF_FAC_008: insufficient deployment deposit"
        );
        let instance_account = instance_account_id(&organization);
        require!(
            self.account_owners.get(&instance_account).is_none(),
            "COF_FAC_009: derived account collision"
        );

        let storage_before = env::storage_usage();
        let requested_by = env::predecessor_account_id();
        self.instances.insert(
            organization.to_vec(),
            PolicyInstance {
                account_id: instance_account.clone(),
                requested_by: requested_by.clone(),
                attached_deposit: attached,
                requested_at_ns: env::block_timestamp(),
                status: DeploymentStatus::Pending,
            },
        );
        self.account_owners
            .insert(instance_account.clone(), organization);
        self.instances.flush();
        self.account_owners.flush();

        let storage_bytes = env::storage_usage().saturating_sub(storage_before);
        let storage_cost = env::storage_byte_cost()
            .checked_mul(u128::from(storage_bytes))
            .unwrap_or_else(|| env::panic_str("COF_FAC_010: storage cost overflow"));
        let instance_balance = attached
            .checked_sub(storage_cost)
            .unwrap_or_else(|| env::panic_str("COF_FAC_011: deployment deposit underflow"));
        require!(
            instance_balance >= NearToken::from_yoctonear(MIN_INSTANCE_BALANCE_YOCTO),
            "COF_FAC_012: deposit cannot fund instance after factory storage"
        );

        emit_event(
            "policy_instance_requested",
            near_sdk::serde_json::json!({
                "account_id": instance_account,
                "requested_by": requested_by,
                "policy_code_hash": Base64VecU8(self.policy_code_hash.to_vec()),
            }),
        );

        let init_args = PolicyInitArgs {
            controller,
            organization_commitment: organization.to_vec().into(),
            policy_digest: policy.to_vec().into(),
            approvers,
            approval_threshold,
        };
        let serialized_args = near_sdk::serde_json::to_vec(&init_args)
            .unwrap_or_else(|_| env::panic_str("COF_FAC_013: policy init serialization failed"));

        Promise::new(instance_account)
            .create_account()
            .transfer(instance_balance)
            .use_global_contract(self.policy_code_hash)
            .function_call(
                "init".to_owned(),
                serialized_args,
                NearToken::from_yoctonear(0),
                POLICY_INIT_GAS,
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_create_policy_instance(organization.to_vec().into()),
            )
    }

    #[private]
    pub fn on_create_policy_instance(&mut self, organization_commitment: Base64VecU8) -> bool {
        let organization = fixed_digest(
            organization_commitment,
            "COF_FAC_014: callback commitment must be 32 bytes",
        );
        let Some(mut instance) = self.instances.get(organization.as_slice()).cloned() else {
            return false;
        };
        if instance.status != DeploymentStatus::Pending {
            return false;
        }

        if env::promise_result_checked(0, MAX_CALLBACK_RESULT_BYTES).is_ok() {
            instance.status = DeploymentStatus::Active;
            let account_id = instance.account_id.clone();
            self.instances.insert(organization.to_vec(), instance);
            emit_event(
                "policy_instance_created",
                near_sdk::serde_json::json!({ "account_id": account_id }),
            );
            true
        } else {
            self.instances.remove(organization.as_slice());
            self.account_owners.remove(&instance.account_id);
            Promise::new(instance.requested_by.clone())
                .transfer(instance.attached_deposit)
                .detach();
            emit_event(
                "policy_instance_failed",
                near_sdk::serde_json::json!({
                    "account_id": instance.account_id,
                    "requested_by": instance.requested_by,
                }),
            );
            false
        }
    }

    pub fn get_policy_code_hash(&self) -> Base64VecU8 {
        self.policy_code_hash.to_vec().into()
    }

    pub fn get_provisioner(&self) -> AccountId {
        self.provisioner.clone()
    }

    pub fn minimum_deployment_deposit(&self) -> U128 {
        MIN_DEPLOYMENT_DEPOSIT_YOCTO.into()
    }

    pub fn get_instance(&self, organization_commitment: Base64VecU8) -> Option<PolicyInstanceView> {
        let organization = fixed_digest(
            organization_commitment,
            "COF_FAC_015: organization commitment must be 32 bytes",
        );
        self.instances
            .get(organization.as_slice())
            .map(|instance| instance_view(organization, instance))
    }

    pub fn list_instances(
        &self,
        from_index: Option<U64>,
        limit: Option<u64>,
    ) -> Vec<PolicyInstanceView> {
        let from = from_index.map_or(0, |value| value.0);
        let limit = limit.unwrap_or(MAX_PAGE_SIZE);
        require!(
            limit > 0 && limit <= MAX_PAGE_SIZE,
            "COF_FAC_016: invalid page size"
        );
        self.instances
            .iter()
            .skip(usize::try_from(from).unwrap_or(usize::MAX))
            .take(usize::try_from(limit).expect("bounded page size fits usize"))
            .map(|(organization, instance)| {
                let mut digest = [0_u8; 32];
                digest.copy_from_slice(organization);
                instance_view(digest, instance)
            })
            .collect()
    }
}

fn validated_approvers(mut approvers: Vec<AccountId>, approval_threshold: u16) -> Vec<AccountId> {
    require!(!approvers.is_empty(), "COF_FAC_017: approvers required");
    require!(
        approvers.len() <= MAX_APPROVERS,
        "COF_FAC_018: too many approvers"
    );
    require!(
        approval_threshold > 0 && usize::from(approval_threshold) <= approvers.len(),
        "COF_FAC_019: invalid approval threshold"
    );
    approvers.sort();
    require!(
        !approvers.windows(2).any(|pair| pair[0] == pair[1]),
        "COF_FAC_020: duplicate approver"
    );
    approvers
}

fn fixed_digest(value: Base64VecU8, error: &str) -> Digest {
    require!(value.0.len() == 32, error);
    let mut output = [0_u8; 32];
    output.copy_from_slice(&value.0);
    output
}

fn instance_account_id(organization: &Digest) -> AccountId {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut label = String::with_capacity(32);
    for byte in organization.iter().take(16) {
        label.push(char::from(HEX[usize::from(byte >> 4)]));
        label.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    format!("{label}.{}", env::current_account_id())
        .parse()
        .unwrap_or_else(|_| env::panic_str("COF_FAC_021: derived account ID is invalid"))
}

fn instance_view(organization: Digest, instance: &PolicyInstance) -> PolicyInstanceView {
    PolicyInstanceView {
        organization_commitment: organization.to_vec().into(),
        account_id: instance.account_id.clone(),
        requested_by: instance.requested_by.clone(),
        attached_deposit: instance.attached_deposit.as_yoctonear().into(),
        requested_at_ns: instance.requested_at_ns.into(),
        status: instance.status,
    }
}

fn emit_event(event: &str, data: near_sdk::serde_json::Value) {
    let event = near_sdk::serde_json::json!({
        "standard": "coffer",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    let serialized = near_sdk::serde_json::to_string(&event)
        .unwrap_or_else(|_| env::panic_str("COF_FAC_022: event serialization failed"));
    env::log_str(&format!("EVENT_JSON:{serialized}"));
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::mock::MockAction;
    use near_sdk::serde_json::Value;
    use near_sdk::test_utils::{VMContextBuilder, accounts, get_created_receipts};
    use near_sdk::{PromiseResult, testing_env};
    use std::collections::HashMap;

    fn digest(byte: u8) -> Base64VecU8 {
        vec![byte; 32].into()
    }

    fn context(predecessor: AccountId, deposit: NearToken) -> near_sdk::VMContext {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id("factory.sandbox".parse().unwrap())
            .signer_account_id(predecessor.clone())
            .predecessor_account_id(predecessor)
            .attached_deposit(deposit)
            .block_timestamp(123);
        builder.build()
    }

    fn contract() -> Contract {
        testing_env!(context(accounts(0), NearToken::from_yoctonear(0)));
        Contract::init(accounts(0), digest(9))
    }

    #[test]
    #[should_panic(expected = "COF_FAC_024: provisioner must be an external account")]
    fn rejects_factory_as_provisioner() {
        testing_env!(context(accounts(0), NearToken::from_yoctonear(0)));
        Contract::init("factory.sandbox".parse().unwrap(), digest(9));
    }

    fn request(contract: &mut Contract, organization: u8) {
        testing_env!(context(accounts(0), NearToken::from_near(1)));
        let _ = contract.create_policy_instance(
            digest(organization),
            accounts(0),
            digest(5),
            vec![accounts(1), accounts(0)],
            2,
        );
    }

    fn callback_context(result: PromiseResult) {
        let current: AccountId = "factory.sandbox".parse().unwrap();
        testing_env!(
            context(current, NearToken::from_yoctonear(0)),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            HashMap::default(),
            vec![result],
        );
    }

    #[test]
    fn creates_locked_global_contract_instance_batch() {
        let mut contract = contract();
        request(&mut contract, 1);
        let instance = contract.get_instance(digest(1)).unwrap();
        assert_eq!(instance.status, DeploymentStatus::Pending);
        assert_eq!(
            instance.account_id,
            "01010101010101010101010101010101.factory.sandbox"
                .parse::<AccountId>()
                .unwrap()
        );

        let actions: Vec<_> = get_created_receipts()
            .into_iter()
            .flat_map(|receipt| receipt.actions)
            .collect();
        assert!(
            actions
                .iter()
                .any(|action| matches!(action, MockAction::CreateAccount { .. }))
        );
        assert!(
            actions
                .iter()
                .any(|action| matches!(action, MockAction::UseGlobalContract { .. }))
        );
        let instance_deposit = actions
            .iter()
            .find_map(|action| match action {
                MockAction::Transfer { deposit, .. }
                    if *deposit >= NearToken::from_yoctonear(MIN_INSTANCE_BALANCE_YOCTO) =>
                {
                    Some(*deposit)
                }
                _ => None,
            })
            .expect("instance funding transfer must be scheduled");
        assert!(instance_deposit < NearToken::from_near(1));
        assert!(!actions.iter().any(|action| matches!(
            action,
            MockAction::AddKeyWithFullAccess { .. }
                | MockAction::AddKeyWithFunctionCall { .. }
                | MockAction::AddGasKeyWithFullAccess { .. }
        )));

        let init = actions
            .iter()
            .find_map(|action| match action {
                MockAction::FunctionCallWeight {
                    method_name, args, ..
                } if method_name == b"init" => Some(args),
                _ => None,
            })
            .expect("policy init call must be scheduled");
        let init: Value = near_sdk::serde_json::from_slice(init).unwrap();
        assert_eq!(init["approval_threshold"], 2);
        assert_eq!(init["controller"], accounts(0).as_str());
    }

    #[test]
    fn successful_callback_activates_instance_once() {
        let mut contract = contract();
        request(&mut contract, 1);
        callback_context(PromiseResult::Successful(Vec::new()));
        assert!(contract.on_create_policy_instance(digest(1)));
        assert_eq!(
            contract.get_instance(digest(1)).unwrap().status,
            DeploymentStatus::Active
        );
        assert!(!contract.on_create_policy_instance(digest(1)));
    }

    #[test]
    fn failed_callback_refunds_and_allows_retry() {
        let mut contract = contract();
        request(&mut contract, 1);
        callback_context(PromiseResult::Failed);
        assert!(!contract.on_create_policy_instance(digest(1)));
        assert!(contract.get_instance(digest(1)).is_none());
        assert!(
            get_created_receipts()
                .iter()
                .flat_map(|receipt| &receipt.actions)
                .any(|action| matches!(action, MockAction::Transfer { deposit, .. } if *deposit == NearToken::from_near(1)))
        );

        callback_context(PromiseResult::Failed);
        assert!(!contract.on_create_policy_instance(digest(1)));
        assert!(get_created_receipts().is_empty());

        request(&mut contract, 1);
        assert!(contract.get_instance(digest(1)).is_some());
    }

    #[test]
    #[should_panic(expected = "COF_FAC_007: organization instance already exists")]
    fn rejects_duplicate_organization_while_pending() {
        let mut contract = contract();
        request(&mut contract, 1);
        request(&mut contract, 1);
    }

    #[test]
    #[should_panic(expected = "COF_FAC_023: only the provisioner can create an instance")]
    fn rejects_unauthorized_provisioner() {
        let mut contract = contract();
        testing_env!(context(accounts(1), NearToken::from_near(1)));
        let _ = contract.create_policy_instance(
            digest(1),
            accounts(1),
            digest(5),
            vec![accounts(1)],
            1,
        );
    }

    #[test]
    #[should_panic(expected = "COF_FAC_009: derived account collision")]
    fn rejects_commitment_prefix_collision() {
        let mut contract = contract();
        request(&mut contract, 1);
        let mut colliding = vec![1; 32];
        colliding[31] = 2;
        testing_env!(context(accounts(0), NearToken::from_near(1)));
        let _ = contract.create_policy_instance(
            colliding.into(),
            accounts(0),
            digest(5),
            vec![accounts(0)],
            1,
        );
    }

    #[test]
    #[should_panic(expected = "COF_FAC_020: duplicate approver")]
    fn rejects_duplicate_approvers() {
        let mut contract = contract();
        testing_env!(context(accounts(0), NearToken::from_near(1)));
        let _ = contract.create_policy_instance(
            digest(1),
            accounts(0),
            digest(5),
            vec![accounts(0), accounts(0)],
            2,
        );
    }

    #[test]
    #[should_panic(expected = "COF_FAC_008: insufficient deployment deposit")]
    fn rejects_underfunded_deployment() {
        let mut contract = contract();
        testing_env!(context(accounts(0), NearToken::from_millinear(249)));
        let _ = contract.create_policy_instance(
            digest(1),
            accounts(0),
            digest(5),
            vec![accounts(0)],
            1,
        );
    }

    #[test]
    fn list_is_bounded() {
        let mut contract = contract();
        request(&mut contract, 1);
        request(&mut contract, 2);
        assert_eq!(contract.list_instances(None, Some(1)).len(), 1);
        assert_eq!(contract.list_instances(Some(1_u64.into()), None).len(), 1);
    }

    #[test]
    #[should_panic(expected = "COF_FAC_016: invalid page size")]
    fn rejects_oversized_page() {
        let contract = contract();
        contract.list_instances(None, Some(51));
    }
}
