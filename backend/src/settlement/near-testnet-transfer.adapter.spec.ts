import { parseEnvironment } from '../config/env.js';
import { AssetRegistry } from '../treasury/asset-registry.js';
import {
  ProviderAdapterError,
  type NearTransferEvidence,
  type NearTransferEvidenceStore,
  type NearTransferInstruction,
} from './provider-adapter.types.js';
import {
  NearTestnetTransferAdapter,
  type NearRpcClient,
} from './near-testnet-transfer.adapter.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const otherOrganizationId = '22222222-2222-4222-8222-222222222222';
const transactionHash = '11111111111111111111111111111111111111111111';
const testTokenCodeHash = '22222222222222222222222222222222222222222222';
const signer = 'payer.coffer.testnet';
const receiver = 'merchant.coffer.testnet';
const tokenContract = 'token.coffer.testnet';

class MemoryEvidenceStore implements NearTransferEvidenceStore {
  private hashes = new Set<string>();
  private references = new Set<string>();

  async claim(evidence: NearTransferEvidence) {
    const hash = `${evidence.network}:${evidence.transactionHash}`;
    const reference = `${evidence.organizationId}:${evidence.referenceId}`;
    if (this.hashes.has(hash) || this.references.has(reference)) {
      throw new ProviderAdapterError('TRANSFER_EVIDENCE_REPLAY', 'replayed');
    }
    this.hashes.add(hash);
    this.references.add(reference);
    return structuredClone(evidence);
  }
}

class FixtureRpc implements NearRpcClient {
  constructor(
    private readonly response: unknown,
    private readonly network = 'testnet',
  ) {}

  async networkId() {
    return this.network;
  }

  async accountCodeHash() {
    return testTokenCodeHash;
  }

  async callFunction(_contractId: string, method: string) {
    if (method === 'ft_metadata') {
      return {
        spec: 'ft-1.0.0',
        name: 'Coffer Test Dollar',
        symbol: 'ctUSD',
        decimals: 6,
      };
    }
    if (method === 'get_test_token_config') {
      return {
        issuer: 'issuer.coffer.testnet',
        maximum_supply: '1000000000000',
        test_only: true,
      };
    }
    if (method === 'storage_balance_of') {
      return { total: '1250000000000000000000', available: '0' };
    }
    throw new Error('Unexpected method');
  }

  async finalTransaction() {
    return structuredClone(this.response);
  }
}

const environment = parseEnvironment({
  LIVE_TRANSFERS_ENABLED: 'true',
  NEAR_TESTNET_TRANSFERS_ENABLED: 'true',
  NEAR_TEST_TOKEN_CONTRACT_ID: tokenContract,
  NEAR_TEST_TOKEN_CODE_HASH: testTokenCodeHash,
});

const nativeInstruction: NearTransferInstruction = {
  organizationId,
  referenceId: 'invoice-native-1',
  network: 'testnet',
  assetId: 'near:testnet:native',
  signerAccountId: signer,
  receiverAccountId: receiver,
  amountAtomic: '1000000000000000000000',
};

function successfulResponse(actions: unknown[], transactionReceiver: string) {
  return {
    final_execution_status: 'FINAL',
    status: { SuccessValue: '' },
    transaction: {
      hash: transactionHash,
      signer_id: signer,
      receiver_id: transactionReceiver,
      actions,
    },
    receipts: [
      {
        receipt_id: 'receipt-1',
        predecessor_id: signer,
        receiver_id: transactionReceiver,
        receipt: { Action: { actions } },
      },
    ],
    receipts_outcome: [
      {
        id: 'receipt-1',
        outcome: {
          executor_id: transactionReceiver,
          status: { SuccessValue: '' },
          logs: [] as string[],
        },
      },
    ],
  };
}

function nativeResponse(amount = nativeInstruction.amountAtomic) {
  return successfulResponse([{ Transfer: { deposit: amount } }], receiver);
}

function ftResponse(input: NearTransferInstruction) {
  const args = Buffer.from(
    JSON.stringify({
      receiver_id: input.receiverAccountId,
      amount: input.amountAtomic,
      ...(input.transferCallMessage
        ? { msg: input.transferCallMessage }
        : input.memo
          ? { memo: input.memo }
          : {}),
    }),
  ).toString('base64');
  const response = successfulResponse(
    [
      {
        FunctionCall: {
          method_name: input.transferCallMessage
            ? 'ft_transfer_call'
            : 'ft_transfer',
          args,
          gas: input.transferCallMessage ? '100000000000000' : '30000000000000',
          deposit: '1',
        },
      },
    ],
    tokenContract,
  );
  response.receipts_outcome[0]!.outcome.logs.push(
    `EVENT_JSON:${JSON.stringify({
      standard: 'nep141',
      version: '1.0.0',
      event: 'ft_transfer',
      data: [
        {
          old_owner_id: input.signerAccountId,
          new_owner_id: input.receiverAccountId,
          amount: input.amountAtomic,
          ...(input.memo ? { memo: input.memo } : {}),
        },
      ],
    })}`,
  );
  return response;
}

function adapter(response: unknown, store = new MemoryEvidenceStore()) {
  return new NearTestnetTransferAdapter(
    environment,
    new AssetRegistry(),
    store,
    new FixtureRpc(response),
  );
}

function tidepoolAdapter(
  response: unknown,
  assetId = `nep141:${tokenContract}`,
) {
  const assets = new AssetRegistry();
  assets.registerProviderAsset({
    assetId,
    adapter: 'near-intents',
    environment: 'testnet',
    network: 'near-testnet',
    symbol: 'USDC',
    decimals: 6,
    kind: 'token',
    tokenContract,
    testOnly: true,
    discoverySource: 'provider',
  });
  return new NearTestnetTransferAdapter(
    environment,
    assets,
    new MemoryEvidenceStore(),
    new FixtureRpc(response),
  );
}

describe('NearTestnetTransferAdapter', () => {
  it('keeps wallet construction disabled unless both explicit gates are enabled', async () => {
    const disabled = new NearTestnetTransferAdapter(
      parseEnvironment({}),
      new AssetRegistry(),
      new MemoryEvidenceStore(),
      new FixtureRpc(nativeResponse()),
    );
    await expect(
      disabled.walletTransaction(nativeInstruction),
    ).rejects.toThrowError(
      expect.objectContaining({ code: 'PROVIDER_DISABLED' }),
    );
  });

  it('builds an exact wallet-signed native transfer instruction without a key', async () => {
    await expect(
      adapter(nativeResponse()).walletTransaction(nativeInstruction),
    ).resolves.toEqual({
      network: 'testnet',
      signerAccountId: signer,
      receiverId: receiver,
      actions: [
        {
          type: 'Transfer',
          amountAtomic: nativeInstruction.amountAtomic,
        },
      ],
    });
  });

  it('builds an exact one-yocto ctUSD ft_transfer instruction after contract and registration preflight', async () => {
    const instruction = {
      ...nativeInstruction,
      referenceId: 'invoice-ft-1',
      assetId: `near:testnet:nep141:${tokenContract}`,
      amountAtomic: '1250000',
      memo: 'invoice-1',
    };
    await expect(
      adapter(ftResponse(instruction)).walletTransaction(instruction),
    ).resolves.toEqual({
      network: 'testnet',
      signerAccountId: signer,
      receiverId: tokenContract,
      actions: [
        {
          type: 'FunctionCall',
          methodName: 'ft_transfer',
          args: {
            receiver_id: receiver,
            amount: '1250000',
            memo: 'invoice-1',
          },
          gas: '30000000000000',
          deposit: '1',
        },
      ],
    });
  });

  it('accepts only finalized exact native evidence and returns a digest', async () => {
    await expect(
      adapter(nativeResponse()).verifyAndClaim({
        ...nativeInstruction,
        transactionHash,
      }),
    ).resolves.toMatchObject({
      provider: 'near-testnet',
      transactionHash,
      amountAtomic: nativeInstruction.amountAtomic,
      evidenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it('accepts an exact finalized ctUSD call', async () => {
    const instruction = {
      ...nativeInstruction,
      referenceId: 'invoice-ft-2',
      assetId: `near:testnet:nep141:${tokenContract}`,
      amountAtomic: '2500000',
    };
    await expect(
      adapter(ftResponse(instruction)).verifyAndClaim({
        ...instruction,
        transactionHash,
      }),
    ).resolves.toMatchObject({ assetId: instruction.assetId });
  });

  it('verifies an exact provider-discovered Tidepool NEP-141 transfer', async () => {
    const instruction = {
      ...nativeInstruction,
      referenceId: 'tidepool-swap-1',
      assetId: `nep141:${tokenContract}`,
      amountAtomic: '1000000',
    };
    await expect(
      tidepoolAdapter(ftResponse(instruction)).verifyAndClaim({
        ...instruction,
        transactionHash,
      }),
    ).resolves.toMatchObject({
      assetId: instruction.assetId,
      transactionHash,
    });
  });

  it('verifies an exact Tidepool INTENTS ft_transfer_call deposit', async () => {
    const instruction = {
      ...nativeInstruction,
      referenceId: 'tidepool-intents-swap-1',
      assetId: `nep141:${tokenContract}`,
      receiverAccountId: 'verifier.tidepool-sandbox.testnet',
      amountAtomic: '1000000',
      transferCallMessage: 'deposit.tidepool-sandbox.testnet',
    };
    await expect(
      tidepoolAdapter(ftResponse(instruction)).verifyAndClaim({
        ...instruction,
        transactionHash,
      }),
    ).resolves.toMatchObject({
      receiverAccountId: 'verifier.tidepool-sandbox.testnet',
      transferCallMessage: 'deposit.tidepool-sandbox.testnet',
    });

    const altered = ftResponse(instruction);
    const call = altered.transaction.actions[0] as {
      FunctionCall: { args: string };
    };
    call.FunctionCall.args = Buffer.from(
      JSON.stringify({
        receiver_id: instruction.receiverAccountId,
        amount: instruction.amountAtomic,
        msg: 'attacker.testnet',
      }),
    ).toString('base64');
    await expect(
      tidepoolAdapter(altered).verifyAndClaim({
        ...instruction,
        referenceId: 'tidepool-intents-swap-altered',
        transactionHash,
      }),
    ).rejects.toMatchObject({ code: 'TRANSFER_EVIDENCE_MISMATCH' });
  });

  it('rejects a ctUSD call with altered gas or an unapproved event memo', async () => {
    const instruction = {
      ...nativeInstruction,
      referenceId: 'invoice-ft-altered',
      assetId: `near:testnet:nep141:${tokenContract}`,
      amountAtomic: '2500000',
    };
    const alteredGas = ftResponse(instruction);
    const call = alteredGas.transaction.actions[0] as {
      FunctionCall: { gas: string };
    };
    call.FunctionCall.gas = '29999999999999';
    await expect(
      adapter(alteredGas).verifyAndClaim({ ...instruction, transactionHash }),
    ).rejects.toMatchObject({ code: 'TRANSFER_EVIDENCE_MISMATCH' });

    const alteredEvent = ftResponse(instruction);
    const event = JSON.parse(
      alteredEvent.receipts_outcome[0]!.outcome.logs[0]!.slice(
        'EVENT_JSON:'.length,
      ),
    ) as { data: Array<Record<string, unknown>> };
    event.data[0]!.memo = 'unapproved';
    alteredEvent.receipts_outcome[0]!.outcome.logs[0] = `EVENT_JSON:${JSON.stringify(event)}`;
    await expect(
      adapter(alteredEvent).verifyAndClaim({
        ...instruction,
        referenceId: 'invoice-ft-altered-event',
        transactionHash,
      }),
    ).rejects.toMatchObject({ code: 'TRANSFER_EVIDENCE_MISMATCH' });
  });

  it('rejects ctUSD when the configured deployed code hash is not verified', async () => {
    const wrongHashEnvironment = parseEnvironment({
      LIVE_TRANSFERS_ENABLED: 'true',
      NEAR_TESTNET_TRANSFERS_ENABLED: 'true',
      NEAR_TEST_TOKEN_CONTRACT_ID: tokenContract,
      NEAR_TEST_TOKEN_CODE_HASH: '33333333333333333333333333333333333333333333',
    });
    const instruction = {
      ...nativeInstruction,
      referenceId: 'invoice-ft-wrong-code',
      assetId: `near:testnet:nep141:${tokenContract}`,
      amountAtomic: '2500000',
    };
    const verifier = new NearTestnetTransferAdapter(
      wrongHashEnvironment,
      new AssetRegistry(),
      new MemoryEvidenceStore(),
      new FixtureRpc(ftResponse(instruction)),
    );
    await expect(verifier.walletTransaction(instruction)).rejects.toMatchObject(
      {
        code: 'TRANSFER_EVIDENCE_MISMATCH',
      },
    );
  });

  it.each([
    ['amount', nativeResponse('999')],
    [
      'receiver',
      successfulResponse(
        [{ Transfer: { deposit: nativeInstruction.amountAtomic } }],
        'attacker.testnet',
      ),
    ],
    [
      'extra action',
      successfulResponse(
        [
          { Transfer: { deposit: nativeInstruction.amountAtomic } },
          { Transfer: { deposit: '1' } },
        ],
        receiver,
      ),
    ],
  ])('rejects mismatched %s evidence', async (_label, response) => {
    await expect(
      adapter(response).verifyAndClaim({
        ...nativeInstruction,
        transactionHash,
      }),
    ).rejects.toMatchObject({ code: 'TRANSFER_EVIDENCE_MISMATCH' });
  });

  it('rejects failed receipts and the wrong RPC network', async () => {
    const failed = nativeResponse();
    (failed.receipts_outcome[0]!.outcome as { status: unknown }).status = {
      Failure: { ActionError: {} },
    };
    await expect(
      adapter(failed).verifyAndClaim({
        ...nativeInstruction,
        transactionHash,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_INVALID' });

    const wrongNetwork = new NearTestnetTransferAdapter(
      environment,
      new AssetRegistry(),
      new MemoryEvidenceStore(),
      new FixtureRpc(nativeResponse(), 'mainnet'),
    );
    await expect(
      wrongNetwork.verifyAndClaim({
        ...nativeInstruction,
        transactionHash,
      }),
    ).rejects.toMatchObject({ code: 'TRANSFER_EVIDENCE_MISMATCH' });
  });

  it('prevents one transaction hash from being claimed twice across tenants', async () => {
    const store = new MemoryEvidenceStore();
    const verifier = adapter(nativeResponse(), store);
    await verifier.verifyAndClaim({ ...nativeInstruction, transactionHash });
    await expect(
      verifier.verifyAndClaim({
        ...nativeInstruction,
        organizationId: otherOrganizationId,
        referenceId: 'other-invoice',
        transactionHash,
      }),
    ).rejects.toMatchObject({ code: 'TRANSFER_EVIDENCE_REPLAY' });
  });
});
