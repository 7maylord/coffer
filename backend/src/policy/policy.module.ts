import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TreasuryModule } from '../treasury/treasury.module.js';
import {
  NEAR_FINAL_VIEW_CLIENT,
  NearPolicyContractVerifier,
  NearRpcFinalViewClient,
} from './near-policy-contract.js';
import { DeterministicPolicyEngine } from './policy-engine.js';
import { PolicyController } from './policy.controller.js';
import { PolicyService } from './policy.service.js';
import { POLICY_STORE } from './policy.types.js';
import { PrismaPolicyStore } from './prisma-policy.store.js';
import { AssetRegistry } from '../treasury/asset-registry.js';
import { PolicyFactoryService } from './policy-factory.service.js';

@Module({
  imports: [AuthModule, TreasuryModule],
  controllers: [PolicyController],
  providers: [
    PrismaPolicyStore,
    NearRpcFinalViewClient,
    NearPolicyContractVerifier,
    {
      provide: POLICY_STORE,
      useExisting: PrismaPolicyStore,
    },
    {
      provide: NEAR_FINAL_VIEW_CLIENT,
      useExisting: NearRpcFinalViewClient,
    },
    {
      provide: DeterministicPolicyEngine,
      inject: [AssetRegistry],
      useFactory: (assets: AssetRegistry) =>
        new DeterministicPolicyEngine(assets),
    },
    PolicyService,
    PolicyFactoryService,
  ],
  exports: [PolicyService, DeterministicPolicyEngine],
})
export class PolicyModule {}
