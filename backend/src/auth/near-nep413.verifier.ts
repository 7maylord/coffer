import { Inject, Injectable } from '@nestjs/common';
import { JsonRpcProvider } from 'near-api-js';
import { verifyMessage } from 'near-api-js/nep413';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import type { Nep413Verification, Nep413Verifier } from './auth.types.js';

@Injectable()
export class NearNep413Verifier implements Nep413Verifier {
  private readonly provider: JsonRpcProvider;

  constructor(
    @Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment,
  ) {
    this.provider = new JsonRpcProvider({ url: environment.NEAR_RPC_URL });
  }

  async verify(input: Nep413Verification): Promise<void> {
    if (this.environment.NEAR_NETWORK !== 'testnet') {
      throw new Error('Unsupported NEAR network');
    }
    await verifyMessage({
      signerAccountId: input.accountId,
      signerPublicKey: input.publicKey,
      signature: input.signature,
      payload: {
        message: input.message,
        recipient: input.recipient,
        nonce: input.nonce,
      },
      provider: this.provider,
    });
  }
}
