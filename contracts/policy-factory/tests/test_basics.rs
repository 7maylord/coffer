use near_api::{AccountId, NearToken, types::CryptoHash};
use near_sdk::json_types::Base64VecU8;
use near_sdk::serde_json::{Value, json};

#[tokio::test]
async fn factory_creates_locked_initialized_policy_instance() -> testresult::TestResult<()> {
    let factory_wasm = build_contract("Cargo.toml")?;
    let policy_wasm = build_contract("../near-policy/Cargo.toml")?;
    let policy_hash = CryptoHash::hash(&policy_wasm);

    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let network = near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = near_api::Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;
    let publisher = near_sandbox::config::DEFAULT_GENESIS_ACCOUNT.to_owned();
    let factory = create_account(&sandbox, "factory.sandbox")
        .await?
        .as_contract();
    let controller = create_account(&sandbox, "controller.sandbox").await?;
    let approver = create_account(&sandbox, "approver.sandbox").await?;

    near_api::Contract::deploy_global_contract_code(policy_wasm)
        .as_hash()
        .with_signer(publisher, signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    near_api::Contract::deploy(factory.account_id().clone())
        .use_code(factory_wasm)
        .with_init_call(
            "init",
            json!({
                "provisioner": controller.account_id(),
                "policy_code_hash": Base64VecU8(policy_hash.0.to_vec())
            }),
        )?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let organization_commitment = Base64VecU8(vec![1; 32]);
    factory
        .call_function(
            "create_policy_instance",
            json!({
                "organization_commitment": organization_commitment,
                "controller": controller.account_id(),
                "policy_digest": Base64VecU8(vec![5; 32]),
                "approvers": [controller.account_id(), approver.account_id()],
                "approval_threshold": 2
            }),
        )
        .transaction()
        .deposit(NearToken::from_near(1))
        .with_signer(controller.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let instance: Value = factory
        .call_function(
            "get_instance",
            json!({"organization_commitment": Base64VecU8(vec![1; 32])}),
        )
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert_eq!(instance["status"], "Active");
    let instance_id: AccountId = instance["account_id"]
        .as_str()
        .ok_or("instance account missing")?
        .parse()?;

    let configuration: Value = near_api::Contract(instance_id.clone())
        .call_function("get_configuration", ())
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert_eq!(
        configuration["controller"],
        controller.account_id().as_str()
    );
    assert_eq!(configuration["approval_threshold"], 2);
    assert_eq!(
        configuration["organization_commitment"],
        near_sdk::serde_json::to_value(Base64VecU8(vec![1; 32]))?
    );

    let keys = near_api::Account(instance_id)
        .list_keys()
        .fetch_from(&network)
        .await?
        .data;
    assert!(
        keys.is_empty(),
        "factory-created policy account must be locked"
    );
    Ok(())
}

fn build_contract(manifest_path: &str) -> testresult::TestResult<Vec<u8>> {
    let path = cargo_near_build::build_with_cli(
        cargo_near_build::BuildOpts::builder()
            .manifest_path(manifest_path)
            .build(),
    )?;
    Ok(std::fs::read(path)?)
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
