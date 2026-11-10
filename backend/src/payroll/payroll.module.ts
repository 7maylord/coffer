import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TreasuryModule } from '../treasury/treasury.module.js';
import { SettlementModule } from '../settlement/settlement.module.js';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import { PayrollController, PayslipController } from './payroll.controller.js';
import { PayrollEnvelopeEncryption } from './payroll-crypto.js';
import { PayrollService } from './payroll.service.js';
import {
  NearAiPayrollAttestationVerifier,
  UnavailablePrivatePayrollAnalyzer,
} from './private-analysis.js';
import {
  createNearAiInferenceClient,
  NEAR_AI_INFERENCE_CLIENT,
  NearAiPrivatePayrollAnalyzer,
} from './near-ai-private.adapter.js';
import { PrismaPayrollStore } from './prisma-payroll.store.js';
import {
  PAYROLL_ATTESTATION_VERIFIER,
  PAYROLL_STORE,
  PRIVATE_PAYROLL_ANALYZER,
} from './payroll.types.js';

@Module({
  imports: [AuthModule, TreasuryModule, SettlementModule],
  controllers: [PayrollController, PayslipController],
  providers: [
    PayrollService,
    PayrollEnvelopeEncryption,
    PrismaPayrollStore,
    UnavailablePrivatePayrollAnalyzer,
    NearAiPrivatePayrollAnalyzer,
    NearAiPayrollAttestationVerifier,
    {
      provide: NEAR_AI_INFERENCE_CLIENT,
      inject: [APP_ENVIRONMENT],
      useFactory: createNearAiInferenceClient,
    },
    { provide: PAYROLL_STORE, useExisting: PrismaPayrollStore },
    {
      provide: PRIVATE_PAYROLL_ANALYZER,
      inject: [
        APP_ENVIRONMENT,
        UnavailablePrivatePayrollAnalyzer,
        NearAiPrivatePayrollAnalyzer,
      ],
      useFactory: (
        environment: AppEnvironment,
        unavailable: UnavailablePrivatePayrollAnalyzer,
        nearAi: NearAiPrivatePayrollAnalyzer,
      ) => (environment.FEATURE_PRIVATE_AI ? nearAi : unavailable),
    },
    {
      provide: PAYROLL_ATTESTATION_VERIFIER,
      useExisting: NearAiPayrollAttestationVerifier,
    },
  ],
  exports: [PayrollService],
})
export class PayrollModule {}
