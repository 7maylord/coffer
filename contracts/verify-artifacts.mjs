import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const abiOnly = process.argv.includes('--abi-only');

const contracts = [
  {
    name: 'near-policy',
    wasm: 'contracts/near-policy/target/near/near_policy.wasm',
    abi: 'contracts/near-policy/target/near/near_policy_abi.json',
    record: 'contracts/near-policy/ARTIFACTS.md',
    functions: [
      'approve_configuration',
      'approve_proposal',
      'cancel_configuration',
      'cancel_proposal',
      'contract_source_metadata',
      'create_proposal',
      'expire_proposal',
      'get_configuration',
      'get_configuration_change',
      'get_pending_configuration',
      'get_proposal',
      'init',
      'list_configuration_changes',
      'list_proposals',
      'migrate',
      'propose_configuration',
    ],
  },
  {
    name: 'policy-factory',
    wasm: 'contracts/policy-factory/target/near/policy_factory.wasm',
    abi: 'contracts/policy-factory/target/near/policy_factory_abi.json',
    record: 'contracts/policy-factory/ARTIFACTS.md',
    functions: [
      'contract_source_metadata',
      'create_policy_instance',
      'get_instance',
      'get_policy_code_hash',
      'get_provisioner',
      'init',
      'list_instances',
      'minimum_deployment_deposit',
      'on_create_policy_instance',
    ],
  },
  {
    name: 'test-token',
    wasm: 'contracts/test-token/target/near/test_token.wasm',
    abi: 'contracts/test-token/target/near/test_token_abi.json',
    record: 'contracts/test-token/ARTIFACTS.md',
    functions: [
      'contract_source_metadata',
      'ft_balance_of',
      'ft_metadata',
      'ft_resolve_transfer',
      'ft_total_supply',
      'ft_transfer',
      'ft_transfer_call',
      'get_test_token_config',
      'mint',
      'new',
      'storage_balance_bounds',
      'storage_balance_of',
      'storage_deposit',
      'storage_unregister',
      'storage_withdraw',
    ],
  },
];

function path(relative) {
  return `${root}${relative}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const contract of contracts) {
  const abiText = await readFile(path(contract.abi), 'utf8');
  const abi = JSON.parse(abiText);
  const functions = abi.body?.functions;
  assert(Array.isArray(functions), `${contract.name}: ABI functions missing`);
  const names = functions.map((entry) => entry.name).sort();
  assert(
    JSON.stringify(names) === JSON.stringify([...contract.functions].sort()),
    `${contract.name}: unexpected public ABI surface: ${names.join(', ')}`,
  );

  if (contract.name === 'near-policy') {
    for (const forbidden of [
      'amount_atomic',
      'authorized_max_atomic',
      'recipient_commitment',
      'asset_id',
      'invoice',
      'payroll',
      'ft_transfer',
      'swap',
      'intent',
    ]) {
      assert(!abiText.toLowerCase().includes(forbidden), `near-policy: forbidden ABI term ${forbidden}`);
    }
    const migration = functions.find((entry) => entry.name === 'migrate');
    assert(
      migration.modifiers?.includes('private') &&
        migration.modifiers?.includes('init'),
      'near-policy: migrate must remain private and init-only',
    );
  } else if (contract.name === 'policy-factory') {
    const callback = functions.find((entry) => entry.name === 'on_create_policy_instance');
    assert(
      callback.modifiers?.includes('private'),
      'policy-factory: deployment callback must remain private',
    );
    for (const forbidden of ['ft_transfer', 'mint', 'swap', 'intent', 'payroll']) {
      assert(
        !abiText.toLowerCase().includes(forbidden),
        `policy-factory: forbidden ABI term ${forbidden}`,
      );
    }
  } else {
    const resolver = functions.find((entry) => entry.name === 'ft_resolve_transfer');
    assert(
      resolver.modifiers?.includes('private'),
      'test-token: resolver must remain private',
    );
  }

  if (!abiOnly) {
    const bytes = await readFile(path(contract.wasm));
    const details = await stat(path(contract.wasm));
    const digest = createHash('sha256').update(bytes).digest('hex');
    const record = await readFile(path(contract.record), 'utf8');
    assert(
      record.includes(`WASM size: \`${details.size}\` bytes`),
      `${contract.name}: recorded WASM size is stale`,
    );
    assert(
      record.includes(`WASM SHA-256: \`${digest}\``),
      `${contract.name}: recorded WASM checksum is stale`,
    );
  }
}

process.stdout.write(
  `Verified ${contracts.length} contract ABI surfaces${abiOnly ? '' : ' and recorded artifacts'}.\n`,
);
