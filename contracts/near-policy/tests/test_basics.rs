use near_api::{AccountId, NearGas, NearToken};
use near_sdk::json_types::Base64VecU8;
use near_sdk::serde_json::{Value, json};

#[tokio::test]
async fn distinct_accounts_reach_policy_quorum() -> testresult::TestResult<()> {
    let wasm_path = cargo_near_build::build_with_cli(Default::default())?;
    let wasm = std::fs::read(wasm_path)?;
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let network = near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = near_api::Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let controller = create_account(&sandbox, "controller.sandbox").await?;
    let approver_a = create_account(&sandbox, "approver-a.sandbox").await?;
    let approver_b = create_account(&sandbox, "approver-b.sandbox").await?;
    let outsider = create_account(&sandbox, "outsider.sandbox").await?;
    let contract = create_account(&sandbox, "policy.sandbox")
        .await?
        .as_contract();

    near_api::Contract::deploy(contract.account_id().clone())
        .use_code(wasm)
        .with_init_call(
            "init",
            json!({
                "controller": controller.account_id(),
                "organization_commitment": Base64VecU8(vec![1; 32]),
                "policy_digest": Base64VecU8(vec![5; 32]),
                "approvers": [
                    controller.account_id(),
                    approver_a.account_id(),
                    approver_b.account_id()
                ],
                "approval_threshold": 2
            }),
        )?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let contract_balance_before_proposal = near_api::Tokens::account(contract.account_id().clone())
        .near_balance()
        .fetch_from(&network)
        .await?;
    let instruction_digest = Base64VecU8(vec![12; 32]);
    let create_args = json!({
        "proposal_id": Base64VecU8(vec![2; 32]),
        "revision": "1",
        "instruction_digest": instruction_digest,
        "policy_version": "1",
        "policy_digest": Base64VecU8(vec![5; 32]),
        "expires_at_ns": "1800000000000000000"
    });
    contract
        .call_function("create_proposal", create_args.clone())
        .transaction()
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(controller.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_failure();

    let create_execution = contract
        .call_function("create_proposal", create_args)
        .transaction()
        .deposit(NearToken::from_near(1))
        .with_signer(controller.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?;
    create_execution.assert_success();
    let contract_balance_after_proposal = near_api::Tokens::account(contract.account_id().clone())
        .near_balance()
        .fetch_from(&network)
        .await?;
    let retained = contract_balance_after_proposal
        .total
        .saturating_sub(contract_balance_before_proposal.total);
    let storage_stake = contract_balance_after_proposal
        .storage_locked
        .saturating_sub(contract_balance_before_proposal.storage_locked);
    assert!(retained >= storage_stake);
    assert!(
        retained.saturating_sub(storage_stake) < NearToken::from_millinear(1),
        "the contract must return the excess deposit; its balance may also receive protocol gas rewards"
    );

    contract
        .call_function(
            "approve_proposal",
            json!({"instruction_digest": instruction_digest}),
        )
        .transaction()
        .deposit(NearToken::from_near(1))
        .with_signer(outsider.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_failure();

    contract
        .call_function(
            "approve_proposal",
            json!({"instruction_digest": instruction_digest}),
        )
        .transaction()
        .deposit(NearToken::from_near(1))
        .with_signer(approver_a.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    contract
        .call_function(
            "approve_proposal",
            json!({"instruction_digest": instruction_digest}),
        )
        .transaction()
        .deposit(NearToken::from_near(1))
        .with_signer(approver_a.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_failure();
    contract
        .call_function(
            "approve_proposal",
            json!({"instruction_digest": instruction_digest}),
        )
        .transaction()
        .deposit(NearToken::from_near(1))
        .with_signer(approver_b.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let proposal: Value = contract
        .call_function(
            "get_proposal",
            json!({"instruction_digest": instruction_digest}),
        )
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert_eq!(proposal["state"], "Approved");
    assert_eq!(proposal["approvals"].as_array().map(Vec::len), Some(2));

    contract
        .call_function(
            "propose_configuration",
            json!({
                "policy_digest": Base64VecU8(vec![9; 32]),
                "approvers": [
                    controller.account_id(),
                    approver_a.account_id(),
                    approver_b.account_id()
                ],
                "approval_threshold": 2,
                "frozen": true
            }),
        )
        .transaction()
        .deposit(NearToken::from_near(1))
        .with_signer(controller.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let pending: Value = contract
        .call_function("get_pending_configuration", ())
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    let configuration_digest = pending["digest"]
        .as_str()
        .ok_or("pending configuration digest missing")?;
    contract
        .call_function(
            "approve_configuration",
            json!({"digest": configuration_digest}),
        )
        .transaction()
        .deposit(NearToken::from_near(1))
        .with_signer(approver_a.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let configuration: Value = contract
        .call_function("get_configuration", ())
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert_eq!(configuration["configuration_version"], "2");
    assert_eq!(configuration["frozen"], true);

    let expiring_digest = Base64VecU8(vec![13; 32]);
    let expires_at_ns = std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)?
        .as_nanos()
        .saturating_add(5_000_000_000);
    contract
        .call_function(
            "propose_configuration",
            json!({
                "policy_digest": Base64VecU8(vec![9; 32]),
                "approvers": [
                    controller.account_id(),
                    approver_a.account_id(),
                    approver_b.account_id()
                ],
                "approval_threshold": 2,
                "frozen": false
            }),
        )
        .transaction()
        .deposit(NearToken::from_near(1))
        .with_signer(controller.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let pending_unfreeze: Value = contract
        .call_function("get_pending_configuration", ())
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    let unfreeze_digest = pending_unfreeze["digest"]
        .as_str()
        .ok_or("pending unfreeze digest missing")?;
    contract
        .call_function("approve_configuration", json!({"digest": unfreeze_digest}))
        .transaction()
        .deposit(NearToken::from_near(1))
        .with_signer(approver_a.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    contract
        .call_function(
            "create_proposal",
            json!({
                "proposal_id": Base64VecU8(vec![3; 32]),
                "revision": "1",
                "instruction_digest": expiring_digest,
                "policy_version": "3",
                "policy_digest": Base64VecU8(vec![9; 32]),
                "expires_at_ns": expires_at_ns.to_string()
            }),
        )
        .transaction()
        .deposit(NearToken::from_near(1))
        .with_signer(controller.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let low_gas_digest = Base64VecU8(vec![14; 32]);
    contract
        .call_function(
            "create_proposal",
            json!({
                "proposal_id": Base64VecU8(vec![4; 32]),
                "revision": "1",
                "instruction_digest": low_gas_digest,
                "policy_version": "3",
                "policy_digest": Base64VecU8(vec![9; 32]),
                "expires_at_ns": "1800000000000000000"
            }),
        )
        .transaction()
        .gas(NearGas::from_tgas(1))
        .deposit(NearToken::from_near(1))
        .with_signer(controller.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_failure();
    let low_gas_proposal: Value = contract
        .call_function(
            "get_proposal",
            json!({"instruction_digest": low_gas_digest}),
        )
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert!(low_gas_proposal.is_null());

    contract
        .call_function(
            "expire_proposal",
            json!({"instruction_digest": expiring_digest}),
        )
        .transaction()
        .with_signer(outsider.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_failure();

    sandbox.fast_forward(30).await?;
    contract
        .call_function(
            "expire_proposal",
            json!({"instruction_digest": expiring_digest}),
        )
        .transaction()
        .with_signer(outsider.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    let expired: Value = contract
        .call_function(
            "get_proposal",
            json!({"instruction_digest": expiring_digest}),
        )
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert_eq!(expired["state"], "Expired");

    Ok(())
}

async fn create_account(
    sandbox: &near_sandbox::Sandbox,
    name: &str,
) -> testresult::TestResult<near_api::Account> {
    let account_id: AccountId = name.parse()?;
    sandbox
        .create_account(account_id.clone())
        .initial_balance(NearToken::from_near(10))
        .send()
        .await?;
    Ok(near_api::Account(account_id))
}
