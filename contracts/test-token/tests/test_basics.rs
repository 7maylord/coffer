use near_api::{AccountId, NearToken};
use near_sdk::json_types::U128;
use near_sdk::serde_json::{Value, json};

#[tokio::test]
async fn registered_transfer_and_failed_receiver_refund_are_exact() -> testresult::TestResult<()> {
    let wasm_path = cargo_near_build::build_with_cli(Default::default())?;
    let wasm = std::fs::read(wasm_path)?;
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let network = near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = near_api::Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    let issuer = create_account(&sandbox, "issuer.sandbox").await?;
    let receiver = create_account(&sandbox, "receiver.sandbox").await?;
    let outsider = create_account(&sandbox, "outsider.sandbox").await?;
    let contract = create_account(&sandbox, "ctusd.sandbox")
        .await?
        .as_contract();

    near_api::Contract::deploy(contract.account_id().clone())
        .use_code(wasm)
        .with_init_call(
            "new",
            json!({
                "issuer": issuer.account_id(),
                "maximum_supply": "1000000000000"
            }),
        )?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let metadata: Value = contract
        .call_function("ft_metadata", ())
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert_eq!(metadata["name"], "Coffer Test Dollar");
    assert_eq!(metadata["symbol"], "ctUSD");
    assert_eq!(metadata["decimals"], 6);

    register(
        &contract,
        receiver.account_id(),
        issuer.account_id(),
        &signer,
        &network,
    )
    .await?;
    register(
        &contract,
        outsider.account_id(),
        issuer.account_id(),
        &signer,
        &network,
    )
    .await?;
    register(
        &contract,
        contract.account_id(),
        issuer.account_id(),
        &signer,
        &network,
    )
    .await?;

    contract
        .call_function(
            "mint",
            json!({
                "receiver_id": issuer.account_id(),
                "amount": "100",
                "memo": "sandbox fixture"
            }),
        )
        .transaction()
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(issuer.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    contract
        .call_function(
            "mint",
            json!({"receiver_id": outsider.account_id(), "amount": "1"}),
        )
        .transaction()
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(outsider.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_failure();

    contract
        .call_function(
            "ft_transfer",
            json!({
                "receiver_id": receiver.account_id(),
                "amount": "37",
                "memo": "sandbox payment"
            }),
        )
        .transaction()
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(issuer.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    assert_eq!(balance(&contract, issuer.account_id(), &network).await?, 63);
    assert_eq!(
        balance(&contract, receiver.account_id(), &network).await?,
        37
    );

    contract
        .call_function(
            "ft_transfer_call",
            json!({
                "receiver_id": contract.account_id(),
                "amount": "20",
                "memo": "must refund",
                "msg": "receiver has no ft_on_transfer"
            }),
        )
        .transaction()
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(issuer.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    assert_eq!(balance(&contract, issuer.account_id(), &network).await?, 63);
    assert_eq!(
        balance(&contract, contract.account_id(), &network).await?,
        0
    );

    // Independent signers submit transfers concurrently into the same balance.
    let send = |sender: AccountId, amount: &str| {
        contract
            .call_function(
                "ft_transfer",
                json!({
                    "receiver_id": outsider.account_id(), "amount": amount
                }),
            )
            .transaction()
            .deposit(NearToken::from_yoctonear(1))
            .with_signer(sender, signer.clone())
            .send_to(&network)
    };
    let (from_issuer, from_receiver) = tokio::join!(
        send(issuer.account_id().clone(), "11"),
        send(receiver.account_id().clone(), "7")
    );
    from_issuer?.assert_success();
    from_receiver?.assert_success();
    assert_eq!(balance(&contract, issuer.account_id(), &network).await?, 52);
    assert_eq!(
        balance(&contract, receiver.account_id(), &network).await?,
        30
    );
    assert_eq!(
        balance(&contract, outsider.account_id(), &network).await?,
        18
    );
    assert_eq!(total_supply(&contract, &network).await?, 100);

    // Return the fixture amounts before exercising unregistration.
    send_back(
        &contract,
        outsider.account_id(),
        issuer.account_id(),
        "11",
        &signer,
        &network,
    )
    .await?;
    send_back(
        &contract,
        outsider.account_id(),
        receiver.account_id(),
        "7",
        &signer,
        &network,
    )
    .await?;

    contract
        .call_function("storage_unregister", json!({"force": false}))
        .transaction()
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(receiver.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_failure();
    assert_eq!(
        balance(&contract, receiver.account_id(), &network).await?,
        37
    );

    contract
        .call_function("storage_unregister", json!({"force": true}))
        .transaction()
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(receiver.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    assert_eq!(
        balance(&contract, receiver.account_id(), &network).await?,
        0
    );
    assert_eq!(total_supply(&contract, &network).await?, 63);
    assert!(
        storage_balance(&contract, receiver.account_id(), &network)
            .await?
            .is_null()
    );

    contract
        .call_function("storage_unregister", json!({"force": false}))
        .transaction()
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(outsider.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    assert!(
        storage_balance(&contract, outsider.account_id(), &network)
            .await?
            .is_null()
    );

    Ok(())
}

async fn register(
    contract: &near_api::Contract,
    account_id: &AccountId,
    signer_account_id: &AccountId,
    signer: &std::sync::Arc<near_api::Signer>,
    network: &near_api::NetworkConfig,
) -> testresult::TestResult<()> {
    contract
        .call_function(
            "storage_deposit",
            json!({"account_id": account_id, "registration_only": true}),
        )
        .transaction()
        .deposit(NearToken::from_millinear(100))
        .with_signer(signer_account_id.clone(), signer.clone())
        .send_to(network)
        .await?
        .assert_success();
    Ok(())
}

async fn balance(
    contract: &near_api::Contract,
    account_id: &AccountId,
    network: &near_api::NetworkConfig,
) -> testresult::TestResult<u128> {
    let balance: U128 = contract
        .call_function("ft_balance_of", json!({"account_id": account_id}))
        .read_only()
        .fetch_from(network)
        .await?
        .data;
    Ok(balance.0)
}

async fn total_supply(
    contract: &near_api::Contract,
    network: &near_api::NetworkConfig,
) -> testresult::TestResult<u128> {
    let supply: U128 = contract
        .call_function("ft_total_supply", ())
        .read_only()
        .fetch_from(network)
        .await?
        .data;
    Ok(supply.0)
}

async fn storage_balance(
    contract: &near_api::Contract,
    account_id: &AccountId,
    network: &near_api::NetworkConfig,
) -> testresult::TestResult<Value> {
    Ok(contract
        .call_function("storage_balance_of", json!({"account_id": account_id}))
        .read_only()
        .fetch_from(network)
        .await?
        .data)
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

async fn send_back(
    contract: &near_api::Contract,
    sender: &AccountId,
    receiver: &AccountId,
    amount: &str,
    signer: &std::sync::Arc<near_api::Signer>,
    network: &near_api::NetworkConfig,
) -> testresult::TestResult<()> {
    contract
        .call_function(
            "ft_transfer",
            json!({"receiver_id": receiver, "amount": amount}),
        )
        .transaction()
        .deposit(NearToken::from_yoctonear(1))
        .with_signer(sender.clone(), signer.clone())
        .send_to(network)
        .await?
        .assert_success();
    Ok(())
}
