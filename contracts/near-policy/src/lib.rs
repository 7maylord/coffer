use near_sdk::borsh::BorshDeserialize;
use near_sdk::json_types::{Base64VecU8, U64, U128};
use near_sdk::store::{IterableMap, IterableSet, LazyOption, LookupMap};
use near_sdk::{AccountId, PanicOnDefault, Promise, assert_one_yocto, env, near, require};

const STATE_VERSION: u16 = 1;
const PROPOSAL_DIGEST_DOMAIN: &[u8] = b"coffer:proposal:v1";
const CONFIGURATION_DIGEST_DOMAIN: &[u8] = b"coffer:configuration:v1";
const MAX_APPROVERS: usize = 16;
const MAX_PAGE_SIZE: u32 = 50;
const MAX_CONFIGURATION_CHANGES: u32 = 1_024;
const MAX_PROPOSALS: u32 = 10_000;
const MAX_PROPOSAL_TYPE_BYTES: usize = 32;
const MAX_CHAIN_ID_BYTES: usize = 64;
const MAX_ASSET_ID_BYTES: usize = 192;
const MAX_OPERATION_BYTES: usize = 64;
const MAX_ENVIRONMENT_BYTES: usize = 32;

type Digest = [u8; 32];

#[near(serializers = [borsh])]
struct ConfigurationChange {
    digest: Digest,
    proposer: AccountId,
    base_version: u64,
    policy_digest: Digest,
    approval_threshold: u16,
    approvers: Vec<AccountId>,
    frozen: bool,
    approvals: Vec<AccountId>,
    state: ConfigurationChangeState,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConfigurationChangeState {
    Pending,
    Applied,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProposalState {
    Pending,
    Approved,
    Cancelled,
    Expired,
}

#[near(serializers = [borsh])]
struct Proposal {
    proposal_id: Digest,
    instruction_digest: Digest,
    revision: u64,
    policy_version: u64,
    policy_digest: Digest,
    expires_at_ns: u64,
    proposer: AccountId,
    state: ProposalState,
    approvals: Vec<AccountId>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    state_version: u16,
    controller: AccountId,
    organization_commitment: Digest,
    policy_digest: Digest,
    configuration_version: u64,
    approval_threshold: u16,
    approvers: IterableSet<AccountId>,
    frozen: bool,
    pending_configuration: LazyOption<Digest>,
    configuration_changes: IterableMap<Vec<u8>, ConfigurationChange>,
    proposals: IterableMap<Vec<u8>, Proposal>,
    proposal_revisions: LookupMap<Vec<u8>, Digest>,
}

/// Synthetic V0 layout for migration testing; this layout was never deployed.
/// This demonstrates a structural conversion, not compatibility with a released
/// contract. Any real upgrade requires the exact deployed source layout.
#[near(serializers = [borsh])]
struct LegacyContractV0 {
    controller: AccountId,
    organization_commitment: Digest,
    policy_digest: Digest,
    configuration_version: u64,
    approval_threshold: u16,
    approvers: IterableSet<AccountId>,
    frozen: bool,
    pending_configuration: LazyOption<Digest>,
    configuration_changes: IterableMap<Vec<u8>, ConfigurationChange>,
    proposals: IterableMap<Vec<u8>, Proposal>,
    proposal_revisions: LookupMap<Vec<u8>, Digest>,
}

#[near(serializers = [json])]
pub struct OrganizationConfigView {
    pub state_version: u16,
    pub controller: AccountId,
    pub organization_commitment: Base64VecU8,
    pub policy_digest: Base64VecU8,
    pub configuration_version: U64,
    pub approval_threshold: u16,
    pub approvers: Vec<AccountId>,
    pub frozen: bool,
}

#[near(serializers = [json])]
pub struct ConfigurationChangeView {
    pub digest: Base64VecU8,
    pub proposer: AccountId,
    pub base_version: U64,
    pub policy_digest: Base64VecU8,
    pub approval_threshold: u16,
    pub approvers: Vec<AccountId>,
    pub frozen: bool,
    pub approvals: Vec<AccountId>,
    pub state: ConfigurationChangeState,
}

#[near(serializers = [json])]
pub struct ProposalView {
    pub proposal_id: Base64VecU8,
    pub instruction_digest: Base64VecU8,
    pub revision: U64,
    pub policy_version: U64,
    pub policy_digest: Base64VecU8,
    pub expires_at_ns: U64,
    pub proposer: AccountId,
    pub state: ProposalState,
    pub approvals: Vec<AccountId>,
    pub stale_policy: bool,
    pub expired: bool,
}

/// Exact off-chain fields committed by `coffer:proposal:v1`.
///
/// This type and [`canonical_proposal_digest`] are Rust library/test APIs, not
/// exported contract methods. Transaction arguments contain commitments only.
#[near(serializers = [json])]
#[derive(Clone)]
pub struct ProposalDigestInput {
    pub organization_commitment: Base64VecU8,
    pub proposal_type: String,
    pub proposal_id: Base64VecU8,
    pub revision: U64,
    pub policy_version: U64,
    pub policy_digest: Base64VecU8,
    pub chain_id: String,
    pub asset_id: String,
    pub amount_atomic: U128,
    pub authorized_max_atomic: U128,
    pub recipient_commitment: Base64VecU8,
    pub expires_at_ns: U64,
    pub nonce: Base64VecU8,
    pub idempotency_key_commitment: Base64VecU8,
    pub operation: String,
    pub environment: String,
}

#[near]
impl Contract {
    #[init]
    pub fn init(
        controller: AccountId,
        organization_commitment: Base64VecU8,
        policy_digest: Base64VecU8,
        approvers: Vec<AccountId>,
        approval_threshold: u16,
    ) -> Self {
        let approvers = validated_approvers(approvers, approval_threshold);
        require!(
            approvers.contains(&controller),
            "COF_CON_005: controller must be an approver"
        );

        let mut approver_set = IterableSet::new(b"approvers".to_vec());
        for approver in approvers {
            approver_set.insert(approver);
        }

        Self {
            state_version: STATE_VERSION,
            controller,
            organization_commitment: fixed_digest(
                organization_commitment,
                "COF_CON_006: organization commitment must be 32 bytes",
            ),
            policy_digest: fixed_digest(
                policy_digest,
                "COF_CON_007: policy digest must be 32 bytes",
            ),
            configuration_version: 1,
            approval_threshold,
            approvers: approver_set,
            frozen: false,
            pending_configuration: LazyOption::new(b"pending-configuration".to_vec(), None),
            configuration_changes: IterableMap::new(b"configuration-changes".to_vec()),
            proposals: IterableMap::new(b"proposals".to_vec()),
            proposal_revisions: LookupMap::new(b"proposal-revisions".to_vec()),
        }
    }

    #[init(ignore_state)]
    #[private]
    pub fn migrate() -> Self {
        let state = env::storage_read(b"STATE")
            .unwrap_or_else(|| env::panic_str("COF_CON_044: state is not initialized"));
        let legacy = LegacyContractV0::try_from_slice(&state)
            .unwrap_or_else(|_| env::panic_str("COF_CON_045: unsupported state layout"));
        Self {
            state_version: STATE_VERSION,
            controller: legacy.controller,
            organization_commitment: legacy.organization_commitment,
            policy_digest: legacy.policy_digest,
            configuration_version: legacy.configuration_version,
            approval_threshold: legacy.approval_threshold,
            approvers: legacy.approvers,
            frozen: legacy.frozen,
            pending_configuration: legacy.pending_configuration,
            configuration_changes: legacy.configuration_changes,
            proposals: legacy.proposals,
            proposal_revisions: legacy.proposal_revisions,
        }
    }

    pub fn get_configuration(&self) -> OrganizationConfigView {
        OrganizationConfigView {
            state_version: self.state_version,
            controller: self.controller.clone(),
            organization_commitment: self.organization_commitment.to_vec().into(),
            policy_digest: self.policy_digest.to_vec().into(),
            configuration_version: self.configuration_version.into(),
            approval_threshold: self.approval_threshold,
            approvers: sorted_accounts(self.approvers.iter().cloned().collect()),
            frozen: self.frozen,
        }
    }

    pub fn get_pending_configuration(&self) -> Option<ConfigurationChangeView> {
        self.pending_configuration
            .get()
            .as_ref()
            .and_then(|digest| self.configuration_changes.get(digest.as_slice()))
            .map(configuration_change_view)
    }

    pub fn get_configuration_change(&self, digest: Base64VecU8) -> Option<ConfigurationChangeView> {
        let digest = fixed_digest(digest, "COF_CON_018: configuration digest must be 32 bytes");
        self.configuration_changes
            .get(digest.as_slice())
            .map(configuration_change_view)
    }

    pub fn list_configuration_changes(
        &self,
        from_index: Option<U64>,
        limit: Option<u32>,
    ) -> Vec<ConfigurationChangeView> {
        let from_index = usize::try_from(from_index.unwrap_or(U64(0)).0)
            .unwrap_or_else(|_| env::panic_str("COF_CON_040: from index too large"));
        let limit = limit.unwrap_or(20);
        require!(
            limit > 0 && limit <= MAX_PAGE_SIZE,
            "COF_CON_041: invalid page size"
        );
        self.configuration_changes
            .iter()
            .skip(from_index)
            .take(limit as usize)
            .map(|(_, change)| configuration_change_view(change))
            .collect()
    }

    #[payable]
    pub fn propose_configuration(
        &mut self,
        policy_digest: Base64VecU8,
        approvers: Vec<AccountId>,
        approval_threshold: u16,
        frozen: bool,
    ) -> Base64VecU8 {
        let storage_before = env::storage_usage();
        require_positive_deposit();
        let caller = self.assert_approver();
        require!(
            self.pending_configuration.get().is_none(),
            "COF_CON_017: configuration change already pending"
        );
        require!(
            self.configuration_changes.len() < MAX_CONFIGURATION_CHANGES,
            "COF_CON_053: configuration history capacity reached"
        );

        let policy_digest =
            fixed_digest(policy_digest, "COF_CON_007: policy digest must be 32 bytes");
        let approvers = validated_approvers(approvers, approval_threshold);
        require!(
            approvers.contains(&self.controller),
            "COF_CON_005: controller must be an approver"
        );
        let base_version = self.configuration_version;
        let digest = configuration_digest(
            base_version,
            &policy_digest,
            approval_threshold,
            &approvers,
            frozen,
        );
        require!(
            self.configuration_changes.get(digest.as_slice()).is_none(),
            "COF_CON_055: configuration change already exists"
        );
        let change = ConfigurationChange {
            digest,
            proposer: caller.clone(),
            base_version,
            policy_digest,
            approval_threshold,
            approvers,
            frozen,
            approvals: vec![caller.clone()],
            state: ConfigurationChangeState::Pending,
        };

        self.configuration_changes.insert(digest.to_vec(), change);
        self.pending_configuration.set(Some(digest));
        if self.approval_threshold == 1 {
            self.apply_configuration(&digest);
        }

        self.flush_storage();
        emit_event(
            "configuration_proposed",
            near_sdk::serde_json::json!({
                "configuration_digest": Base64VecU8(digest.to_vec()),
                "base_version": base_version,
                "proposer": caller,
            }),
        );
        charge_storage(storage_before, env::predecessor_account_id());

        digest.to_vec().into()
    }

    #[payable]
    pub fn approve_configuration(&mut self, digest: Base64VecU8) -> bool {
        let storage_before = env::storage_usage();
        require_positive_deposit();
        let caller = self.assert_approver();
        let expected = fixed_digest(digest, "COF_CON_018: configuration digest must be 32 bytes");
        let pending_digest = *self
            .pending_configuration
            .get()
            .as_ref()
            .unwrap_or_else(|| env::panic_str("COF_CON_019: no configuration change pending"));
        require!(pending_digest == expected, "COF_CON_021: digest mismatch");
        let quorum_reached = {
            let change = self
                .configuration_changes
                .get_mut(expected.as_slice())
                .unwrap_or_else(|| env::panic_str("COF_CON_051: configuration history missing"));
            require!(
                change.state == ConfigurationChangeState::Pending,
                "COF_CON_052: configuration change not pending"
            );
            require!(
                change.base_version == self.configuration_version,
                "COF_CON_020: stale configuration change"
            );
            require!(
                !change.approvals.contains(&caller),
                "COF_CON_022: duplicate configuration approval"
            );
            change.approvals.push(caller.clone());
            change.approvals.len() >= usize::from(self.approval_threshold)
        };

        if quorum_reached {
            self.apply_configuration(&expected);
            self.flush_storage();
            emit_event(
                "configuration_applied",
                near_sdk::serde_json::json!({
                    "configuration_digest": Base64VecU8(expected.to_vec()),
                    "configuration_version": self.configuration_version,
                    "approver": caller,
                }),
            );
            charge_storage(storage_before, env::predecessor_account_id());
            true
        } else {
            self.flush_storage();
            emit_event(
                "configuration_approved",
                near_sdk::serde_json::json!({
                    "configuration_digest": Base64VecU8(expected.to_vec()),
                    "approver": caller,
                }),
            );
            charge_storage(storage_before, env::predecessor_account_id());
            false
        }
    }

    #[payable]
    pub fn cancel_configuration(&mut self, digest: Base64VecU8) {
        assert_one_yocto();
        let caller = env::predecessor_account_id();
        let expected = fixed_digest(digest, "COF_CON_018: configuration digest must be 32 bytes");
        let pending_digest = *self
            .pending_configuration
            .get()
            .as_ref()
            .unwrap_or_else(|| env::panic_str("COF_CON_019: no configuration change pending"));
        require!(pending_digest == expected, "COF_CON_021: digest mismatch");
        let change = self
            .configuration_changes
            .get_mut(expected.as_slice())
            .unwrap_or_else(|| env::panic_str("COF_CON_051: configuration history missing"));
        require!(
            change.state == ConfigurationChangeState::Pending,
            "COF_CON_052: configuration change not pending"
        );
        require!(
            caller == self.controller || caller == change.proposer,
            "COF_CON_023: configuration cancellation not authorized"
        );
        change.state = ConfigurationChangeState::Cancelled;
        self.pending_configuration.set(None);
        self.flush_storage();
        emit_event(
            "configuration_cancelled",
            near_sdk::serde_json::json!({
                "configuration_digest": Base64VecU8(expected.to_vec()),
                "cancelled_by": caller,
            }),
        );
    }

    #[payable]
    pub fn create_proposal(
        &mut self,
        proposal_id: Base64VecU8,
        revision: U64,
        instruction_digest: Base64VecU8,
        policy_version: U64,
        policy_digest: Base64VecU8,
        expires_at_ns: U64,
    ) -> Base64VecU8 {
        let storage_before = env::storage_usage();
        require_positive_deposit();
        let caller = self.assert_approver();
        require!(!self.frozen, "COF_CON_024: organization is frozen");
        require!(
            self.proposals.len() < MAX_PROPOSALS,
            "COF_CON_054: proposal capacity reached"
        );
        require!(
            policy_version.0 == self.configuration_version,
            "COF_CON_025: stale policy version"
        );
        let policy_digest =
            fixed_digest(policy_digest, "COF_CON_007: policy digest must be 32 bytes");
        require!(
            policy_digest == self.policy_digest,
            "COF_CON_026: stale policy digest"
        );
        require!(
            expires_at_ns.0 > env::block_timestamp(),
            "COF_CON_027: proposal already expired"
        );

        let proposal_id = fixed_digest(proposal_id, "COF_CON_013: proposal id must be 32 bytes");
        let instruction_digest = fixed_digest(
            instruction_digest,
            "COF_CON_028: instruction digest must be 32 bytes",
        );
        let revision_key =
            proposal_revision_key(&self.organization_commitment, &proposal_id, revision.0);
        require!(
            self.proposal_revisions.get(&revision_key).is_none(),
            "COF_CON_029: proposal revision already exists"
        );
        require!(
            self.proposals.get(instruction_digest.as_slice()).is_none(),
            "COF_CON_030: instruction digest already exists"
        );

        let proposal = Proposal {
            proposal_id,
            instruction_digest,
            revision: revision.0,
            policy_version: policy_version.0,
            policy_digest,
            expires_at_ns: expires_at_ns.0,
            proposer: caller.clone(),
            state: ProposalState::Pending,
            approvals: Vec::new(),
        };
        self.proposal_revisions
            .insert(revision_key, instruction_digest);
        self.proposals.insert(instruction_digest.to_vec(), proposal);

        self.flush_storage();
        emit_event(
            "proposal_created",
            near_sdk::serde_json::json!({
                "proposal_id": Base64VecU8(proposal_id.to_vec()),
                "instruction_digest": Base64VecU8(instruction_digest.to_vec()),
                "revision": revision,
                "policy_version": policy_version,
                "expires_at_ns": expires_at_ns,
                "proposer": caller,
            }),
        );
        charge_storage(storage_before, env::predecessor_account_id());

        instruction_digest.to_vec().into()
    }

    #[payable]
    pub fn approve_proposal(&mut self, instruction_digest: Base64VecU8) -> bool {
        let storage_before = env::storage_usage();
        require_positive_deposit();
        let caller = self.assert_approver();
        require!(!self.frozen, "COF_CON_024: organization is frozen");
        let digest = fixed_digest(
            instruction_digest,
            "COF_CON_028: instruction digest must be 32 bytes",
        );
        let threshold = usize::from(self.approval_threshold);
        let configuration_version = self.configuration_version;
        let policy_digest = self.policy_digest;
        let now = env::block_timestamp();
        let proposal = self
            .proposals
            .get_mut(digest.as_slice())
            .unwrap_or_else(|| env::panic_str("COF_CON_031: proposal not found"));

        require!(
            proposal.state == ProposalState::Pending,
            "COF_CON_032: proposal not pending"
        );
        require!(
            proposal.expires_at_ns > now,
            "COF_CON_033: proposal expired"
        );
        require!(
            proposal.policy_version == configuration_version
                && proposal.policy_digest == policy_digest,
            "COF_CON_034: proposal policy is stale"
        );
        require!(
            !proposal.approvals.contains(&caller),
            "COF_CON_035: duplicate proposal approval"
        );
        proposal.approvals.push(caller.clone());
        let approved = if proposal.approvals.len() >= threshold {
            proposal.state = ProposalState::Approved;
            true
        } else {
            false
        };
        self.flush_storage();
        emit_event(
            "proposal_approved",
            near_sdk::serde_json::json!({
                "instruction_digest": Base64VecU8(digest.to_vec()),
                "approver": caller,
                "quorum_reached": approved,
            }),
        );
        charge_storage(storage_before, env::predecessor_account_id());
        approved
    }

    #[payable]
    pub fn cancel_proposal(&mut self, instruction_digest: Base64VecU8) {
        assert_one_yocto();
        let caller = env::predecessor_account_id();
        let digest = fixed_digest(
            instruction_digest,
            "COF_CON_028: instruction digest must be 32 bytes",
        );
        let proposal = self
            .proposals
            .get_mut(digest.as_slice())
            .unwrap_or_else(|| env::panic_str("COF_CON_031: proposal not found"));
        require!(
            caller == self.controller || caller == proposal.proposer,
            "COF_CON_036: proposal cancellation not authorized"
        );
        require!(
            matches!(
                proposal.state,
                ProposalState::Pending | ProposalState::Approved
            ),
            "COF_CON_037: proposal cannot be cancelled"
        );
        proposal.state = ProposalState::Cancelled;
        emit_event(
            "proposal_cancelled",
            near_sdk::serde_json::json!({
                "instruction_digest": Base64VecU8(digest.to_vec()),
                "cancelled_by": caller,
            }),
        );
    }

    pub fn expire_proposal(&mut self, instruction_digest: Base64VecU8) {
        let digest = fixed_digest(
            instruction_digest,
            "COF_CON_028: instruction digest must be 32 bytes",
        );
        let proposal = self
            .proposals
            .get_mut(digest.as_slice())
            .unwrap_or_else(|| env::panic_str("COF_CON_031: proposal not found"));
        require!(
            matches!(
                proposal.state,
                ProposalState::Pending | ProposalState::Approved
            ),
            "COF_CON_038: proposal is terminal"
        );
        require!(
            proposal.expires_at_ns <= env::block_timestamp(),
            "COF_CON_039: proposal has not expired"
        );
        proposal.state = ProposalState::Expired;
        emit_event(
            "proposal_expired",
            near_sdk::serde_json::json!({
                "instruction_digest": Base64VecU8(digest.to_vec()),
            }),
        );
    }

    pub fn get_proposal(&self, instruction_digest: Base64VecU8) -> Option<ProposalView> {
        let digest = fixed_digest(
            instruction_digest,
            "COF_CON_028: instruction digest must be 32 bytes",
        );
        self.proposals
            .get(digest.as_slice())
            .map(|proposal| self.proposal_view(proposal))
    }

    pub fn list_proposals(&self, from_index: Option<U64>, limit: Option<u32>) -> Vec<ProposalView> {
        let from_index = usize::try_from(from_index.unwrap_or(U64(0)).0)
            .unwrap_or_else(|_| env::panic_str("COF_CON_040: from index too large"));
        let limit = limit.unwrap_or(20);
        require!(
            limit > 0 && limit <= MAX_PAGE_SIZE,
            "COF_CON_041: invalid page size"
        );

        self.proposals
            .iter()
            .skip(from_index)
            .take(limit as usize)
            .map(|(_, proposal)| self.proposal_view(proposal))
            .collect()
    }
}

impl Contract {
    fn assert_approver(&self) -> AccountId {
        let caller = env::predecessor_account_id();
        require!(
            self.approvers.contains(&caller),
            "COF_CON_042: caller is not an approver"
        );
        caller
    }

    fn flush_storage(&mut self) {
        self.approvers.flush();
        self.pending_configuration.flush();
        self.configuration_changes.flush();
        self.proposals.flush();
        self.proposal_revisions.flush();
    }

    fn apply_configuration(&mut self, digest: &Digest) {
        let (approvers, policy_digest, approval_threshold, frozen) = {
            let change = self
                .configuration_changes
                .get_mut(digest.as_slice())
                .unwrap_or_else(|| env::panic_str("COF_CON_051: configuration history missing"));
            require!(
                change.state == ConfigurationChangeState::Pending,
                "COF_CON_052: configuration change not pending"
            );
            change.state = ConfigurationChangeState::Applied;
            (
                change.approvers.clone(),
                change.policy_digest,
                change.approval_threshold,
                change.frozen,
            )
        };
        self.approvers.clear();
        for approver in approvers {
            self.approvers.insert(approver);
        }
        self.policy_digest = policy_digest;
        self.approval_threshold = approval_threshold;
        self.frozen = frozen;
        self.configuration_version = self
            .configuration_version
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("COF_CON_043: configuration version overflow"));
        self.pending_configuration.set(None);
    }

    fn proposal_view(&self, proposal: &Proposal) -> ProposalView {
        ProposalView {
            proposal_id: proposal.proposal_id.to_vec().into(),
            instruction_digest: proposal.instruction_digest.to_vec().into(),
            revision: proposal.revision.into(),
            policy_version: proposal.policy_version.into(),
            policy_digest: proposal.policy_digest.to_vec().into(),
            expires_at_ns: proposal.expires_at_ns.into(),
            proposer: proposal.proposer.clone(),
            state: proposal.state,
            approvals: proposal.approvals.clone(),
            stale_policy: proposal.policy_version != self.configuration_version
                || proposal.policy_digest != self.policy_digest,
            expired: proposal.expires_at_ns <= env::block_timestamp(),
        }
    }
}

pub fn canonical_proposal_digest(input: ProposalDigestInput) -> Digest {
    bounded(
        &input.proposal_type,
        MAX_PROPOSAL_TYPE_BYTES,
        "COF_CON_008: proposal type too long",
    );
    bounded(
        &input.chain_id,
        MAX_CHAIN_ID_BYTES,
        "COF_CON_009: chain id too long",
    );
    bounded(
        &input.asset_id,
        MAX_ASSET_ID_BYTES,
        "COF_CON_010: asset id too long",
    );
    bounded(
        &input.operation,
        MAX_OPERATION_BYTES,
        "COF_CON_011: operation too long",
    );
    bounded(
        &input.environment,
        MAX_ENVIRONMENT_BYTES,
        "COF_CON_012: environment too long",
    );

    let organization_commitment = fixed_digest(
        input.organization_commitment,
        "COF_CON_006: organization commitment must be 32 bytes",
    );
    let proposal_id = fixed_digest(
        input.proposal_id,
        "COF_CON_013: proposal id must be 32 bytes",
    );
    let policy_digest = fixed_digest(
        input.policy_digest,
        "COF_CON_007: policy digest must be 32 bytes",
    );
    let recipient_commitment = fixed_digest(
        input.recipient_commitment,
        "COF_CON_014: recipient commitment must be 32 bytes",
    );
    let nonce = fixed_digest(input.nonce, "COF_CON_015: nonce must be 32 bytes");
    let idempotency_key_commitment = fixed_digest(
        input.idempotency_key_commitment,
        "COF_CON_016: idempotency commitment must be 32 bytes",
    );

    let mut bytes = Vec::with_capacity(512);
    push_bytes(&mut bytes, PROPOSAL_DIGEST_DOMAIN);
    bytes.extend_from_slice(&organization_commitment);
    push_bytes(&mut bytes, input.proposal_type.as_bytes());
    bytes.extend_from_slice(&proposal_id);
    bytes.extend_from_slice(&input.revision.0.to_be_bytes());
    bytes.extend_from_slice(&input.policy_version.0.to_be_bytes());
    bytes.extend_from_slice(&policy_digest);
    push_bytes(&mut bytes, input.chain_id.as_bytes());
    push_bytes(&mut bytes, input.asset_id.as_bytes());
    bytes.extend_from_slice(&input.amount_atomic.0.to_be_bytes());
    bytes.extend_from_slice(&input.authorized_max_atomic.0.to_be_bytes());
    bytes.extend_from_slice(&recipient_commitment);
    bytes.extend_from_slice(&input.expires_at_ns.0.to_be_bytes());
    bytes.extend_from_slice(&nonce);
    bytes.extend_from_slice(&idempotency_key_commitment);
    push_bytes(&mut bytes, input.operation.as_bytes());
    push_bytes(&mut bytes, input.environment.as_bytes());
    env::sha256_array(&bytes)
}

fn configuration_digest(
    base_version: u64,
    policy_digest: &Digest,
    approval_threshold: u16,
    approvers: &[AccountId],
    frozen: bool,
) -> Digest {
    let mut bytes = Vec::with_capacity(512);
    push_bytes(&mut bytes, CONFIGURATION_DIGEST_DOMAIN);
    bytes.extend_from_slice(&base_version.to_be_bytes());
    bytes.extend_from_slice(policy_digest);
    bytes.extend_from_slice(&approval_threshold.to_be_bytes());
    bytes.push(u8::from(frozen));
    bytes.extend_from_slice(&(approvers.len() as u16).to_be_bytes());
    for approver in approvers {
        push_bytes(&mut bytes, approver.as_bytes());
    }
    env::sha256_array(&bytes)
}

fn proposal_revision_key(
    organization_commitment: &Digest,
    proposal_id: &Digest,
    revision: u64,
) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(72);
    bytes.extend_from_slice(organization_commitment);
    bytes.extend_from_slice(proposal_id);
    bytes.extend_from_slice(&revision.to_be_bytes());
    env::sha256_array(&bytes).to_vec()
}

fn validated_approvers(approvers: Vec<AccountId>, approval_threshold: u16) -> Vec<AccountId> {
    require!(!approvers.is_empty(), "COF_CON_001: approvers required");
    require!(
        approvers.len() <= MAX_APPROVERS,
        "COF_CON_002: too many approvers"
    );
    require!(
        approval_threshold > 0 && usize::from(approval_threshold) <= approvers.len(),
        "COF_CON_003: invalid approval threshold"
    );
    let approvers = sorted_accounts(approvers);
    require!(
        !approvers.windows(2).any(|pair| pair[0] == pair[1]),
        "COF_CON_004: duplicate approver"
    );
    approvers
}

fn sorted_accounts(mut accounts: Vec<AccountId>) -> Vec<AccountId> {
    accounts.sort();
    accounts
}

fn configuration_change_view(change: &ConfigurationChange) -> ConfigurationChangeView {
    ConfigurationChangeView {
        digest: change.digest.to_vec().into(),
        proposer: change.proposer.clone(),
        base_version: change.base_version.into(),
        policy_digest: change.policy_digest.to_vec().into(),
        approval_threshold: change.approval_threshold,
        approvers: change.approvers.clone(),
        frozen: change.frozen,
        approvals: change.approvals.clone(),
        state: change.state,
    }
}

fn fixed_digest(value: Base64VecU8, error: &str) -> Digest {
    require!(value.0.len() == 32, error);
    let mut output = [0_u8; 32];
    output.copy_from_slice(&value.0);
    output
}

fn bounded(value: &str, max_bytes: usize, error: &str) {
    require!(!value.is_empty() && value.len() <= max_bytes, error);
}

fn push_bytes(output: &mut Vec<u8>, value: &[u8]) {
    let length = u32::try_from(value.len()).expect("bounded fields fit in u32");
    output.extend_from_slice(&length.to_be_bytes());
    output.extend_from_slice(value);
}

fn require_positive_deposit() {
    require!(
        !env::attached_deposit().is_zero(),
        "COF_CON_046: storage deposit required"
    );
}

fn charge_storage(storage_before: u64, payer: AccountId) {
    let bytes_used = env::storage_usage().saturating_sub(storage_before);
    let required = env::storage_byte_cost()
        .checked_mul(u128::from(bytes_used))
        .unwrap_or_else(|| env::panic_str("COF_CON_047: storage cost overflow"));
    let attached = env::attached_deposit();
    require!(
        attached >= required,
        "COF_CON_048: insufficient storage deposit"
    );
    let refund = attached
        .checked_sub(required)
        .unwrap_or_else(|| env::panic_str("COF_CON_049: storage refund underflow"));
    if !refund.is_zero() {
        Promise::new(payer).transfer(refund).detach();
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
        .unwrap_or_else(|_| env::panic_str("COF_CON_050: event serialization failed"));
    env::log_str(&format!("EVENT_JSON:{serialized}"));
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::mock::MockAction;
    use near_sdk::test_utils::{VMContextBuilder, accounts, get_created_receipts};
    use near_sdk::{NearToken, testing_env};

    fn context(predecessor: AccountId, timestamp: u64, storage_deposit: bool) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(accounts(5))
            .signer_account_id(predecessor.clone())
            .predecessor_account_id(predecessor)
            .block_timestamp(timestamp)
            .attached_deposit(if storage_deposit {
                NearToken::from_near(1)
            } else {
                NearToken::from_yoctonear(0)
            });
        testing_env!(builder.build());
    }

    fn one_yocto_context(predecessor: AccountId, timestamp: u64) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(accounts(5))
            .signer_account_id(predecessor.clone())
            .predecessor_account_id(predecessor)
            .block_timestamp(timestamp)
            .attached_deposit(NearToken::from_yoctonear(1));
        testing_env!(builder.build());
    }

    fn digest(byte: u8) -> Base64VecU8 {
        vec![byte; 32].into()
    }

    fn assert_panic_contains(result: std::thread::Result<()>, expected: &str) {
        let panic = result.expect_err("operation must reject the exhausted capacity");
        let message = panic
            .downcast_ref::<String>()
            .map(String::as_str)
            .or_else(|| panic.downcast_ref::<&str>().copied())
            .unwrap_or("");
        assert!(message.contains(expected), "unexpected panic: {message}");
    }

    fn digest_input() -> ProposalDigestInput {
        ProposalDigestInput {
            organization_commitment: digest(1),
            proposal_type: "invoice_payment".to_owned(),
            proposal_id: digest(2),
            revision: 3_u64.into(),
            policy_version: 4_u64.into(),
            policy_digest: digest(5),
            chain_id: "near:testnet".to_owned(),
            asset_id: "near:testnet:native".to_owned(),
            amount_atomic: U128(1_250_000_000_000_000_000_000_000),
            authorized_max_atomic: U128(1_300_000_000_000_000_000_000_000),
            recipient_commitment: digest(6),
            expires_at_ns: 1_800_000_000_000_000_000_u64.into(),
            nonce: digest(7),
            idempotency_key_commitment: digest(8),
            operation: "transfer".to_owned(),
            environment: "testnet".to_owned(),
        }
    }

    fn contract() -> Contract {
        Contract::init(
            accounts(0),
            digest(1),
            digest(5),
            vec![accounts(1), accounts(0), accounts(2)],
            2,
        )
    }

    fn create(contract: &mut Contract, instruction_byte: u8, expires_at: u64) {
        context(accounts(0), 100, true);
        contract.create_proposal(
            digest(instruction_byte),
            1_u64.into(),
            digest(instruction_byte + 10),
            1_u64.into(),
            digest(5),
            expires_at.into(),
        );
    }

    #[test]
    fn initializes_bounded_configuration() {
        context(accounts(0), 0, false);
        let configuration = contract().get_configuration();
        assert_eq!(configuration.state_version, 1);
        assert_eq!(configuration.controller, accounts(0));
        assert_eq!(configuration.approval_threshold, 2);
        assert_eq!(
            configuration.approvers,
            vec![accounts(0), accounts(1), accounts(2)]
        );
        assert_eq!(configuration.configuration_version.0, 1);
        assert!(!configuration.frozen);
    }

    #[test]
    #[should_panic(expected = "COF_CON_004: duplicate approver")]
    fn rejects_duplicate_approvers() {
        context(accounts(0), 0, false);
        Contract::init(
            accounts(0),
            digest(1),
            digest(5),
            vec![accounts(0), accounts(0)],
            2,
        );
    }

    #[test]
    fn configuration_requires_current_quorum() {
        context(accounts(0), 0, true);
        let mut contract = contract();
        let change = contract.propose_configuration(
            digest(9),
            vec![accounts(0), accounts(1), accounts(3)],
            2,
            true,
        );
        let change_lookup = change.clone();
        assert_eq!(contract.get_configuration().configuration_version.0, 1);

        context(accounts(1), 0, true);
        assert!(contract.approve_configuration(change));
        let configuration = contract.get_configuration();
        assert_eq!(configuration.configuration_version.0, 2);
        assert_eq!(configuration.policy_digest, digest(9));
        assert!(configuration.frozen);
        assert_eq!(
            configuration.approvers,
            vec![accounts(0), accounts(1), accounts(3)]
        );
        assert!(contract.get_pending_configuration().is_none());
        let history = contract.get_configuration_change(change_lookup).unwrap();
        assert_eq!(history.state, ConfigurationChangeState::Applied);
        assert_eq!(history.approvals, vec![accounts(0), accounts(1)]);
        assert_eq!(contract.list_configuration_changes(None, None).len(), 1);
    }

    #[test]
    fn cancelled_configuration_keeps_immutable_audit_history() {
        context(accounts(0), 0, true);
        let mut contract = contract();
        let change = contract.propose_configuration(
            digest(9),
            vec![accounts(0), accounts(1), accounts(3)],
            2,
            false,
        );
        let change_lookup = change.clone();

        one_yocto_context(accounts(0), 1);
        contract.cancel_configuration(change);

        assert!(contract.get_pending_configuration().is_none());
        let history = contract.get_configuration_change(change_lookup).unwrap();
        assert_eq!(history.state, ConfigurationChangeState::Cancelled);
        assert_eq!(history.approvals, vec![accounts(0)]);
        assert_eq!(contract.get_configuration().configuration_version.0, 1);
    }

    #[test]
    #[should_panic(expected = "COF_CON_055: configuration change already exists")]
    fn cancelled_configuration_history_cannot_be_overwritten() {
        context(accounts(0), 0, true);
        let mut contract = contract();
        let change = contract.propose_configuration(
            digest(9),
            vec![accounts(0), accounts(1), accounts(3)],
            2,
            false,
        );
        one_yocto_context(accounts(0), 1);
        contract.cancel_configuration(change);

        context(accounts(0), 2, true);
        contract.propose_configuration(
            digest(9),
            vec![accounts(0), accounts(1), accounts(3)],
            2,
            false,
        );
    }

    #[test]
    fn two_distinct_approvers_reach_proposal_quorum() {
        context(accounts(0), 0, false);
        let mut contract = contract();
        create(&mut contract, 2, 1_000);

        context(accounts(1), 200, true);
        assert!(!contract.approve_proposal(digest(12)));
        context(accounts(2), 200, true);
        assert!(contract.approve_proposal(digest(12)));
        let proposal = contract.get_proposal(digest(12)).unwrap();
        assert_eq!(proposal.state, ProposalState::Approved);
        assert_eq!(proposal.approvals, vec![accounts(1), accounts(2)]);
    }

    #[test]
    #[should_panic(expected = "COF_CON_035: duplicate proposal approval")]
    fn one_account_cannot_approve_twice() {
        context(accounts(0), 0, false);
        let mut contract = contract();
        create(&mut contract, 2, 1_000);
        context(accounts(1), 200, true);
        contract.approve_proposal(digest(12));
        contract.approve_proposal(digest(12));
    }

    #[test]
    #[should_panic(expected = "COF_CON_029: proposal revision already exists")]
    fn same_proposal_revision_cannot_change_instruction() {
        context(accounts(0), 0, false);
        let mut contract = contract();
        create(&mut contract, 2, 1_000);
        context(accounts(0), 200, true);
        contract.create_proposal(
            digest(2),
            1_u64.into(),
            digest(99),
            1_u64.into(),
            digest(5),
            1_000_u64.into(),
        );
    }

    #[test]
    #[should_panic(expected = "COF_CON_042: caller is not an approver")]
    fn unauthorized_account_cannot_create_proposal() {
        context(accounts(4), 100, true);
        let mut contract = contract();
        contract.create_proposal(
            digest(2),
            1_u64.into(),
            digest(12),
            1_u64.into(),
            digest(5),
            1_000_u64.into(),
        );
    }

    #[test]
    #[should_panic(expected = "COF_CON_033: proposal expired")]
    fn expired_proposal_cannot_be_approved() {
        context(accounts(0), 0, false);
        let mut contract = contract();
        create(&mut contract, 2, 1_000);
        context(accounts(1), 1_001, true);
        contract.approve_proposal(digest(12));
    }

    #[test]
    #[should_panic(expected = "COF_CON_048: insufficient storage deposit")]
    fn proposal_writer_must_cover_storage_growth() {
        context(accounts(0), 0, false);
        let mut contract = contract();
        one_yocto_context(accounts(0), 100);
        contract.create_proposal(
            digest(2),
            1_u64.into(),
            digest(12),
            1_u64.into(),
            digest(5),
            1_000_u64.into(),
        );
    }

    #[test]
    fn proposal_writer_receives_exact_excess_storage_refund() {
        let mut contract = contract();
        context(accounts(0), 100, true);
        let storage_before = env::storage_usage();
        contract.create_proposal(
            digest(20),
            1_u64.into(),
            digest(30),
            1_u64.into(),
            digest(5),
            1_000_u64.into(),
        );
        let storage_after = env::storage_usage();
        let required = env::storage_byte_cost()
            .checked_mul(u128::from(storage_after - storage_before))
            .expect("bounded storage cost");
        let expected_refund = NearToken::from_near(1)
            .checked_sub(required)
            .expect("storage deposit covers growth");
        let refund_receipt = get_created_receipts()
            .into_iter()
            .find(|receipt| receipt.receiver_id == accounts(0))
            .expect("refund receipt for the payer");

        assert_eq!(refund_receipt.actions.len(), 1);
        assert!(matches!(
            &refund_receipt.actions[0],
            MockAction::Transfer { deposit, .. } if *deposit == expected_refund
        ));
    }

    #[test]
    fn proposal_capacity_is_enforced_before_new_state_is_written() {
        context(accounts(0), 0, false);
        let mut contract = contract();
        for index in 0..MAX_PROPOSALS {
            let mut key = [0_u8; 32];
            key[..4].copy_from_slice(&index.to_be_bytes());
            contract.proposals.insert(
                key.to_vec(),
                Proposal {
                    proposal_id: key,
                    instruction_digest: key,
                    revision: 1,
                    policy_version: 1,
                    policy_digest: [5; 32],
                    expires_at_ns: 1_000,
                    proposer: accounts(0),
                    state: ProposalState::Cancelled,
                    approvals: Vec::new(),
                },
            );
        }

        context(accounts(0), 100, true);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.create_proposal(
                digest(20),
                1_u64.into(),
                digest(30),
                1_u64.into(),
                digest(5),
                1_000_u64.into(),
            );
        }));
        std::mem::forget(contract);
        assert_panic_contains(result, "COF_CON_054: proposal capacity reached");
    }

    #[test]
    fn configuration_capacity_is_enforced_before_new_state_is_written() {
        context(accounts(0), 0, false);
        let mut contract = contract();
        for index in 0..MAX_CONFIGURATION_CHANGES {
            let mut key = [0_u8; 32];
            key[..4].copy_from_slice(&index.to_be_bytes());
            contract.configuration_changes.insert(
                key.to_vec(),
                ConfigurationChange {
                    digest: key,
                    proposer: accounts(0),
                    base_version: 1,
                    policy_digest: [5; 32],
                    approval_threshold: 2,
                    approvers: vec![accounts(0), accounts(1)],
                    frozen: false,
                    approvals: vec![accounts(0)],
                    state: ConfigurationChangeState::Cancelled,
                },
            );
        }

        context(accounts(0), 100, true);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.propose_configuration(digest(9), vec![accounts(0), accounts(1)], 2, false);
        }));
        std::mem::forget(contract);
        assert_panic_contains(
            result,
            "COF_CON_053: configuration history capacity reached",
        );
    }

    #[test]
    #[should_panic(expected = "COF_CON_024: organization is frozen")]
    fn frozen_organization_rejects_new_proposals() {
        context(accounts(0), 0, false);
        let mut contract = contract();
        context(accounts(0), 10, true);
        let change = contract.propose_configuration(
            digest(5),
            vec![accounts(0), accounts(1), accounts(2)],
            2,
            true,
        );
        context(accounts(1), 20, true);
        contract.approve_configuration(change);
        context(accounts(0), 30, true);
        contract.create_proposal(
            digest(2),
            1_u64.into(),
            digest(12),
            2_u64.into(),
            digest(5),
            1_000_u64.into(),
        );
    }

    #[test]
    #[should_panic(expected = "COF_CON_034: proposal policy is stale")]
    fn policy_change_invalidates_pending_proposal() {
        context(accounts(0), 0, false);
        let mut contract = contract();
        create(&mut contract, 2, 1_000);
        context(accounts(0), 110, true);
        let change = contract.propose_configuration(
            digest(9),
            vec![accounts(0), accounts(1), accounts(2)],
            2,
            false,
        );
        context(accounts(1), 120, true);
        contract.approve_configuration(change);
        context(accounts(2), 130, true);
        contract.approve_proposal(digest(12));
    }

    #[test]
    fn list_is_bounded_and_v0_migration_preserves_configuration_proposals_and_approvals() {
        context(accounts(0), 0, false);
        let mut contract = contract();
        create(&mut contract, 2, 1_000);
        create(&mut contract, 3, 1_000);
        context(accounts(1), 100, true);
        contract.approve_proposal(digest(12));
        context(accounts(0), 110, true);
        let configuration_digest = contract.propose_configuration(
            digest(9),
            vec![accounts(0), accounts(1), accounts(2)],
            2,
            false,
        );
        context(accounts(1), 120, true);
        assert!(contract.approve_configuration(configuration_digest.clone()));

        let page = contract.list_proposals(Some(U64(1)), Some(1));
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].instruction_digest, digest(13));

        contract.flush_storage();
        let legacy = LegacyContractV0 {
            controller: contract.controller,
            organization_commitment: contract.organization_commitment,
            policy_digest: contract.policy_digest,
            configuration_version: contract.configuration_version,
            approval_threshold: contract.approval_threshold,
            approvers: contract.approvers,
            frozen: contract.frozen,
            pending_configuration: contract.pending_configuration,
            configuration_changes: contract.configuration_changes,
            proposals: contract.proposals,
            proposal_revisions: contract.proposal_revisions,
        };
        env::state_write(&legacy);
        context(accounts(5), 200, false);
        let migrated = Contract::migrate();
        let configuration = migrated.get_configuration();
        assert_eq!(configuration.state_version, STATE_VERSION);
        assert_eq!(configuration.configuration_version.0, 2);
        assert_eq!(configuration.policy_digest, digest(9));
        assert_eq!(migrated.list_proposals(None, Some(10)).len(), 2);
        assert_eq!(
            migrated.get_proposal(digest(12)).unwrap().approvals,
            vec![accounts(1)]
        );
        assert_eq!(
            migrated
                .get_configuration_change(configuration_digest)
                .unwrap()
                .state,
            ConfigurationChangeState::Applied
        );
    }

    #[test]
    #[should_panic(expected = "COF_CON_045: unsupported state layout")]
    fn migration_rejects_current_v1_layout() {
        context(accounts(0), 0, false);
        let contract = contract();
        env::state_write(&contract);
        context(accounts(5), 1, false);
        Contract::migrate();
    }

    #[test]
    fn events_expose_commitments_without_financial_payloads() {
        context(accounts(0), 0, false);
        let mut contract = contract();
        create(&mut contract, 2, 1_000);

        let logs = near_sdk::test_utils::get_logs().join("\n");
        assert!(logs.starts_with("EVENT_JSON:"));
        assert!(logs.contains("\"standard\":\"coffer\""));
        assert!(logs.contains("\"event\":\"proposal_created\""));
        for forbidden in [
            "amount_atomic",
            "authorized_max",
            "recipient",
            "salary",
            "invoice_payment",
            "near:testnet:native",
        ] {
            assert!(!logs.contains(forbidden));
        }
    }

    #[test]
    fn proposer_can_cancel_and_expired_proposal_can_be_finalized() {
        context(accounts(0), 0, false);
        let mut contract = contract();
        create(&mut contract, 2, 1_000);
        one_yocto_context(accounts(0), 200);
        contract.cancel_proposal(digest(12));
        assert_eq!(
            contract.get_proposal(digest(12)).unwrap().state,
            ProposalState::Cancelled
        );

        context(accounts(0), 200, true);
        contract.create_proposal(
            digest(3),
            1_u64.into(),
            digest(13),
            1_u64.into(),
            digest(5),
            1_000_u64.into(),
        );
        context(accounts(4), 1_001, false);
        contract.expire_proposal(digest(13));
        assert_eq!(
            contract.get_proposal(digest(13)).unwrap().state,
            ProposalState::Expired
        );
    }

    #[test]
    fn material_change_produces_a_different_digest() {
        context(accounts(0), 0, false);
        let original = canonical_proposal_digest(digest_input());
        let baseline = digest_input();
        let mut variants = Vec::new();
        let mut changed = baseline.clone();
        changed.organization_commitment = digest(9);
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.proposal_type.push_str("_v2");
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.proposal_id = digest(9);
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.revision = (changed.revision.0 + 1).into();
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.policy_version = (changed.policy_version.0 + 1).into();
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.policy_digest = digest(9);
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.chain_id = "near:mainnet".to_owned();
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.asset_id = "near:testnet:nep141:ctusd.testnet".to_owned();
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.amount_atomic = U128(changed.amount_atomic.0 + 1);
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.authorized_max_atomic = U128(changed.authorized_max_atomic.0 + 1);
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.recipient_commitment = digest(9);
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.expires_at_ns = (changed.expires_at_ns.0 + 1).into();
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.nonce = digest(9);
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.idempotency_key_commitment = digest(9);
        variants.push(changed);
        let mut changed = baseline.clone();
        changed.operation = "payroll_transfer".to_owned();
        variants.push(changed);
        let mut changed = baseline;
        changed.environment = "mainnet".to_owned();
        variants.push(changed);

        for variant in variants {
            assert_ne!(original, canonical_proposal_digest(variant));
        }
    }

    #[test]
    fn proposal_digest_matches_golden_vector() {
        context(accounts(0), 0, false);
        assert_eq!(
            canonical_proposal_digest(digest_input()),
            [
                33, 48, 113, 230, 27, 52, 116, 10, 253, 183, 48, 21, 132, 34, 143, 8, 144, 63, 54,
                209, 233, 244, 75, 130, 171, 165, 245, 231, 165, 142, 243, 101,
            ]
        );
    }
}
