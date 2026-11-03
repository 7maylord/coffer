use near_contract_standards::fungible_token::events::{FtBurn, FtMint};
use near_contract_standards::fungible_token::metadata::{
    FT_METADATA_SPEC, FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{
    AccountId, NearToken, PanicOnDefault, PromiseOrValue, assert_one_yocto, env, near, require,
};

pub const TOKEN_NAME: &str = "Coffer Test Dollar";
pub const TOKEN_SYMBOL: &str = "ctUSD";
pub const TOKEN_DECIMALS: u8 = 6;
pub const MAX_MEMO_BYTES: usize = 256;
pub const MAX_TRANSFER_MESSAGE_BYTES: usize = 4_096;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    issuer: AccountId,
    maximum_supply: u128,
}

#[near(serializers = [json])]
pub struct TestTokenConfigView {
    pub issuer: AccountId,
    pub maximum_supply: U128,
    pub test_only: bool,
}

#[near]
impl Contract {
    #[init]
    pub fn new(issuer: AccountId, maximum_supply: U128) -> Self {
        require!(maximum_supply.0 > 0, "COF_FT_001: maximum supply required");
        token_metadata().assert_valid();

        let mut token = FungibleToken::new(b"token-accounts".to_vec());
        token.internal_register_account(&issuer);

        Self {
            token,
            issuer,
            maximum_supply: maximum_supply.0,
        }
    }

    pub fn get_test_token_config(&self) -> TestTokenConfigView {
        TestTokenConfigView {
            issuer: self.issuer.clone(),
            maximum_supply: self.maximum_supply.into(),
            test_only: true,
        }
    }

    /// Issues valueless test tokens to an already registered account.
    #[payable]
    pub fn mint(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        assert_one_yocto();
        require!(
            env::predecessor_account_id() == self.issuer,
            "COF_FT_002: only the test issuer may mint"
        );
        require!(amount.0 > 0, "COF_FT_003: mint amount must be positive");
        validate_memo(&memo);

        let next_supply = self
            .token
            .total_supply
            .checked_add(amount.0)
            .unwrap_or_else(|| env::panic_str("COF_FT_004: total supply overflow"));
        require!(
            next_supply <= self.maximum_supply,
            "COF_FT_005: maximum supply exceeded"
        );

        self.token.internal_deposit(&receiver_id, amount.0);
        FtMint {
            owner_id: receiver_id.as_ref(),
            amount,
            memo: memo.as_deref(),
        }
        .emit();
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        validate_memo(&memo);
        self.token.ft_transfer(receiver_id, amount, memo);
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        validate_memo(&memo);
        require!(
            msg.len() <= MAX_TRANSFER_MESSAGE_BYTES,
            "COF_FT_007: transfer message too long"
        );
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        self.token
            .internal_ft_resolve_transfer(&sender_id, receiver_id, amount)
            .0
            .into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        if let Some((account_id, balance)) = self.token.internal_storage_unregister(force) {
            if balance > 0 {
                FtBurn {
                    owner_id: account_id.as_ref(),
                    amount: balance.into(),
                    memo: Some("account unregistered"),
                }
                .emit();
            }
            true
        } else {
            false
        }
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        token_metadata()
    }
}

fn token_metadata() -> FungibleTokenMetadata {
    FungibleTokenMetadata {
        spec: FT_METADATA_SPEC.to_owned(),
        name: TOKEN_NAME.to_owned(),
        symbol: TOKEN_SYMBOL.to_owned(),
        icon: None,
        reference: None,
        reference_hash: None,
        decimals: TOKEN_DECIMALS,
    }
}

fn validate_memo(memo: &Option<String>) {
    if let Some(memo) = memo {
        require!(memo.len() <= MAX_MEMO_BYTES, "COF_FT_006: memo too long");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::mock::MockAction;
    use near_sdk::test_utils::{VMContextBuilder, accounts, get_created_receipts, get_logs};
    use near_sdk::testing_env;

    const MAXIMUM_SUPPLY: u128 = 1_000_000_000_000;

    fn context(predecessor: AccountId, attached_deposit: NearToken) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(accounts(5))
            .signer_account_id(predecessor.clone())
            .predecessor_account_id(predecessor)
            .attached_deposit(attached_deposit);
        testing_env!(builder.build());
    }

    fn contract() -> Contract {
        context(accounts(0), NearToken::from_yoctonear(0));
        Contract::new(accounts(0), U128(MAXIMUM_SUPPLY))
    }

    fn register(contract: &mut Contract, account_id: AccountId) {
        let minimum = contract.storage_balance_bounds().min;
        context(account_id.clone(), minimum);
        contract.storage_deposit(Some(account_id), Some(true));
    }

    #[test]
    fn metadata_and_config_are_explicitly_test_only() {
        let contract = contract();
        let metadata = contract.ft_metadata();
        let config = contract.get_test_token_config();

        assert_eq!(metadata.spec, "ft-1.0.0");
        assert_eq!(metadata.name, "Coffer Test Dollar");
        assert_eq!(metadata.symbol, "ctUSD");
        assert_eq!(metadata.decimals, 6);
        assert!(metadata.icon.is_none());
        assert!(config.test_only);
        assert_eq!(config.issuer, accounts(0));
        assert_eq!(config.maximum_supply.0, MAXIMUM_SUPPLY);
    }

    #[test]
    fn storage_registration_uses_standard_fixed_balance() {
        let mut contract = contract();
        let minimum = contract.storage_balance_bounds().min;
        assert!(!minimum.is_zero());
        assert!(contract.storage_balance_of(accounts(1)).is_none());

        register(&mut contract, accounts(1));

        let balance = contract.storage_balance_of(accounts(1)).unwrap();
        assert_eq!(balance.total, minimum);
        assert!(balance.available.is_zero());
    }

    #[test]
    fn storage_registration_refunds_exact_excess_deposit() {
        let mut contract = contract();
        let minimum = contract.storage_balance_bounds().min;
        let excess = NearToken::from_millinear(100);
        context(
            accounts(1),
            minimum.checked_add(excess).expect("bounded test deposit"),
        );

        let balance = contract.storage_deposit(Some(accounts(1)), Some(true));
        let refund_receipt = get_created_receipts()
            .into_iter()
            .find(|receipt| receipt.receiver_id == accounts(1))
            .expect("registration refund receipt");

        assert_eq!(balance.total, minimum);
        assert!(balance.available.is_zero());
        assert_eq!(refund_receipt.actions.len(), 1);
        assert!(matches!(
            &refund_receipt.actions[0],
            MockAction::Transfer { deposit, .. } if *deposit == excess
        ));
    }

    #[test]
    fn issuer_mints_exact_atomic_amount_to_registered_account() {
        let mut contract = contract();
        register(&mut contract, accounts(1));
        context(accounts(0), NearToken::from_yoctonear(1));

        contract.mint(accounts(1), U128(25_000_001), Some("fixture".to_owned()));

        assert_eq!(contract.ft_balance_of(accounts(1)).0, 25_000_001);
        assert_eq!(contract.ft_total_supply().0, 25_000_001);
        let logs = get_logs().join("\n");
        assert!(logs.contains("EVENT_JSON:"));
        assert!(logs.contains("\"standard\":\"nep141\""));
        assert!(logs.contains("\"event\":\"ft_mint\""));
        assert!(!logs.contains("USDC"));
    }

    #[test]
    #[should_panic(expected = "COF_FT_002: only the test issuer may mint")]
    fn unauthorized_account_cannot_mint() {
        let mut contract = contract();
        register(&mut contract, accounts(1));
        context(accounts(2), NearToken::from_yoctonear(1));
        contract.mint(accounts(1), U128(1), None);
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn mint_requires_one_yocto() {
        let mut contract = contract();
        context(accounts(0), NearToken::from_yoctonear(0));
        contract.mint(accounts(0), U128(1), None);
    }

    #[test]
    #[should_panic(expected = "COF_FT_005: maximum supply exceeded")]
    fn maximum_supply_cannot_be_exceeded() {
        let mut contract = contract();
        context(accounts(0), NearToken::from_yoctonear(1));
        contract.mint(accounts(0), U128(MAXIMUM_SUPPLY), None);
        contract.mint(accounts(0), U128(1), None);
    }

    #[test]
    #[should_panic(expected = "COF_FT_003: mint amount must be positive")]
    fn zero_mint_is_rejected() {
        let mut contract = contract();
        context(accounts(0), NearToken::from_yoctonear(1));
        contract.mint(accounts(0), U128(0), None);
    }

    #[test]
    #[should_panic(expected = "is not registered")]
    fn mint_receiver_must_be_registered() {
        let mut contract = contract();
        context(accounts(0), NearToken::from_yoctonear(1));
        contract.mint(accounts(1), U128(1), None);
    }

    #[test]
    fn registered_accounts_transfer_exact_atomic_amount() {
        let mut contract = contract();
        register(&mut contract, accounts(1));
        context(accounts(0), NearToken::from_yoctonear(1));
        contract.mint(accounts(0), U128(100), None);

        context(accounts(0), NearToken::from_yoctonear(1));
        contract.ft_transfer(accounts(1), U128(37), Some("test payment".to_owned()));

        assert_eq!(contract.ft_balance_of(accounts(0)).0, 63);
        assert_eq!(contract.ft_balance_of(accounts(1)).0, 37);
        assert_eq!(contract.ft_total_supply().0, 100);
        let logs = get_logs().join("\n");
        assert!(logs.contains("\"event\":\"ft_transfer\""));
        assert!(logs.contains("\"amount\":\"37\""));
        assert!(!logs.contains("USDC"));
    }

    #[test]
    #[should_panic(expected = "is not registered")]
    fn transfer_receiver_must_be_registered() {
        let mut contract = contract();
        context(accounts(0), NearToken::from_yoctonear(1));
        contract.mint(accounts(0), U128(100), None);
        contract.ft_transfer(accounts(1), U128(1), None);
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn transfer_requires_one_yocto() {
        let mut contract = contract();
        register(&mut contract, accounts(1));
        context(accounts(0), NearToken::from_yoctonear(1));
        contract.mint(accounts(0), U128(100), None);
        context(accounts(0), NearToken::from_yoctonear(0));
        contract.ft_transfer(accounts(1), U128(1), None);
    }

    #[test]
    #[should_panic(expected = "doesn't have enough balance")]
    fn transfer_cannot_exceed_balance() {
        let mut contract = contract();
        register(&mut contract, accounts(1));
        context(accounts(0), NearToken::from_yoctonear(1));
        contract.mint(accounts(0), U128(10), None);
        contract.ft_transfer(accounts(1), U128(11), None);
    }

    #[test]
    #[should_panic(expected = "COF_FT_006: memo too long")]
    fn oversized_memo_is_rejected() {
        let mut contract = contract();
        context(accounts(0), NearToken::from_yoctonear(1));
        contract.mint(accounts(0), U128(1), Some("x".repeat(MAX_MEMO_BYTES + 1)));
    }

    #[test]
    #[should_panic(expected = "COF_FT_007: transfer message too long")]
    fn oversized_transfer_message_is_rejected() {
        let mut contract = contract();
        context(accounts(0), NearToken::from_yoctonear(1));
        let _ = contract.ft_transfer_call(
            accounts(1),
            U128(1),
            None,
            "x".repeat(MAX_TRANSFER_MESSAGE_BYTES + 1),
        );
    }

    #[test]
    fn forced_unregister_burns_balance_and_emits_standard_event() {
        let mut contract = contract();
        register(&mut contract, accounts(1));
        context(accounts(0), NearToken::from_yoctonear(1));
        contract.mint(accounts(1), U128(50), None);

        context(accounts(1), NearToken::from_yoctonear(1));
        assert!(contract.storage_unregister(Some(true)));

        assert_eq!(contract.ft_balance_of(accounts(1)).0, 0);
        assert_eq!(contract.ft_total_supply().0, 0);
        assert!(get_logs().join("\n").contains("\"event\":\"ft_burn\""));
    }

    #[test]
    #[should_panic(expected = "Can't unregister the account with the positive balance")]
    fn unregister_without_force_rejects_positive_balance() {
        let mut contract = contract();
        register(&mut contract, accounts(1));
        context(accounts(0), NearToken::from_yoctonear(1));
        contract.mint(accounts(1), U128(50), None);

        context(accounts(1), NearToken::from_yoctonear(1));
        contract.storage_unregister(Some(false));
    }
    #[test]
    fn refund_after_sender_or_receiver_unregister_preserves_supply() {
        for unregister_sender in [true, false] {
            // Distinct prefixes are unnecessary: each prior scenario removes its receiver.
            let mut contract = contract();
            register(&mut contract, accounts(1));
            context(accounts(0), NearToken::from_yoctonear(1));
            contract.mint(accounts(0), U128(100), None);
            let _ = contract.ft_transfer_call(accounts(1), U128(100), None, String::new());
            let removed = if unregister_sender {
                accounts(0)
            } else {
                accounts(1)
            };
            context(removed, NearToken::from_yoctonear(1));
            assert!(contract.storage_unregister(Some(true)));
            let mut builder = VMContextBuilder::new();
            builder
                .current_account_id(accounts(5))
                .predecessor_account_id(accounts(5));
            testing_env!(
                builder.build(),
                near_sdk::test_vm_config(),
                near_sdk::RuntimeFeesConfig::test(),
                std::collections::HashMap::default(),
                vec![near_sdk::PromiseResult::Failed]
            );
            assert_eq!(
                contract
                    .ft_resolve_transfer(accounts(0), accounts(1), U128(100))
                    .0,
                100
            );
            assert_eq!(contract.ft_total_supply().0, 0);
            assert_eq!(contract.ft_balance_of(accounts(0)).0, 0);
            assert_eq!(contract.ft_balance_of(accounts(1)).0, 0);
            // Remove remaining registration before the next fixture reuses its keys.
            context(
                if unregister_sender {
                    accounts(1)
                } else {
                    accounts(0)
                },
                NearToken::from_yoctonear(1),
            );
            contract.storage_unregister(Some(false));
        }
    }
}
