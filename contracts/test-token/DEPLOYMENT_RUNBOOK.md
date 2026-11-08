# Approval-gated `ctUSD` testnet runbook

This review procedure for C-09 was executed once on 2026-11-06 with the concrete
testnet values recorded in `ARTIFACTS.md`. The commands below remain templates:
every future account creation, deployment, registration, mint, or transfer
requires separate human authorization with reviewed account IDs and amounts.
Never place a seed phrase or private key in this repository or shell history.

## Required reviewed values

- `<CONTRACT_ID>`: dedicated NEAR testnet contract account;
- `<ISSUER_ID>`: human-controlled test issuer account;
- `<RECEIVER_ID>`: synthetic test recipient;
- `<MAXIMUM_SUPPLY_ATOMIC>`: integer cap in 6-decimal atomic units;
- `<MINT_AMOUNT_ATOMIC>` and `<TRANSFER_AMOUNT_ATOMIC>`: bounded test amounts;
- approved reproducible WASM checksum from the release manifest.

The contract account, issuer, receiver, configured network, amounts, and WASM
checksum must be reviewed together before any signing step.

## Read-only preflight

```bash
near account view-account-summary <CONTRACT_ID> network-config testnet now
near account view-account-summary <ISSUER_ID> network-config testnet now
near account view-account-summary <RECEIVER_ID> network-config testnet now
shasum -a 256 target/near/test_token.wasm
```

## Deployment preview

The final `display` action signs and prints the transaction without broadcasting
it. It still requires explicit authorization and a reviewed keychain account.

```bash
near contract deploy <CONTRACT_ID> use-file target/near/test_token.wasm with-init-call new json-args '{"issuer":"<ISSUER_ID>","maximum_supply":"<MAXIMUM_SUPPLY_ATOMIC>"}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain display
```

After reviewing the signed transaction, an authorized human may separately
approve the equivalent command ending in `send`.

## Read-only post-deployment verification

```bash
near contract inspect <CONTRACT_ID> network-config testnet now
near contract call-function as-read-only <CONTRACT_ID> ft_metadata empty-args network-config testnet now
near contract call-function as-read-only <CONTRACT_ID> get_test_token_config empty-args network-config testnet now
near contract call-function as-read-only <CONTRACT_ID> ft_total_supply empty-args network-config testnet now
near contract download-wasm <CONTRACT_ID> save-to-file /tmp/coffer-test-token-deployed.wasm network-config testnet now
shasum -a 256 /tmp/coffer-test-token-deployed.wasm
```

The downloaded checksum must equal the approved artifact before minting.

## Registration, mint, and transfer previews

Determine the exact storage minimum from `storage_balance_bounds`; do not guess
it. Each command ends in `display` and therefore does not broadcast.

```bash
near contract call-function as-read-only <CONTRACT_ID> storage_balance_bounds empty-args network-config testnet now
near account manage-storage-deposit <CONTRACT_ID> deposit <RECEIVER_ID> '<REVIEWED_STORAGE_DEPOSIT>' sign-as <ISSUER_ID> network-config testnet sign-with-keychain display
near contract call-function as-transaction <CONTRACT_ID> mint json-args '{"receiver_id":"<ISSUER_ID>","amount":"<MINT_AMOUNT_ATOMIC>","memo":"synthetic test fixture"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as <ISSUER_ID> network-config testnet sign-with-keychain display
near contract call-function as-transaction <CONTRACT_ID> ft_transfer json-args '{"receiver_id":"<RECEIVER_ID>","amount":"<TRANSFER_AMOUNT_ATOMIC>","memo":"synthetic settlement proof"}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as <ISSUER_ID> network-config testnet sign-with-keychain display
```

Each broadcast, if later approved, must be verified using its actual hash:

```bash
near transaction view-status <TX_HASH> network-config testnet
near tokens <ISSUER_ID> view-ft-balance <CONTRACT_ID> network-config testnet now
near tokens <RECEIVER_ID> view-ft-balance <CONTRACT_ID> network-config testnet now
```

Record the network, contract ID, artifact checksum, transaction hash, signer,
receiver, exact atomic amount, final receipt outcomes, and NEP-141 event. Label
all evidence `TESTNET` and `VALUELESS ctUSD`; never label it USDC or an Intents
payment.
