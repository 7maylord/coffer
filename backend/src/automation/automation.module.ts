import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import { PolicyModule } from '../policy/policy.module.js';
import {
  createNearAiInferenceClient,
  NEAR_AI_INFERENCE_CLIENT,
} from '../payroll/near-ai-private.adapter.js';
import { TreasuryModule } from '../treasury/treasury.module.js';
import { AutomationController } from './automation.controller.js';
import { AutomationService } from './automation.service.js';
import {
  MockCfoInferenceAdapter,
  NearAiCfoInferenceAdapter,
} from './ai-adapters.js';
import {
  AUTOMATION_STORE,
  CFO_INFERENCE_ADAPTER,
  MOCK_VENDOR_ADAPTER,
} from './automation.types.js';
import { SeededMockVendorAdapter } from './mock-vendor.adapter.js';
import { PrismaAutomationStore } from './prisma-automation.store.js';

@Module({
  imports: [AuthModule, TreasuryModule, PolicyModule],
  controllers: [AutomationController],
  providers: [
    AutomationService,
    PrismaAutomationStore,
    MockCfoInferenceAdapter,
    NearAiCfoInferenceAdapter,
    {
      provide: NEAR_AI_INFERENCE_CLIENT,
      inject: [APP_ENVIRONMENT],
      useFactory: createNearAiInferenceClient,
    },
    SeededMockVendorAdapter,
    { provide: AUTOMATION_STORE, useExisting: PrismaAutomationStore },
    { provide: MOCK_VENDOR_ADAPTER, useExisting: SeededMockVendorAdapter },
    {
      provide: CFO_INFERENCE_ADAPTER,
      inject: [
        APP_ENVIRONMENT,
        MockCfoInferenceAdapter,
        NearAiCfoInferenceAdapter,
      ],
      useFactory: (
        environment: AppEnvironment,
        mock: MockCfoInferenceAdapter,
        nearAi: NearAiCfoInferenceAdapter,
      ) => (environment.AI_CFO_PROVIDER === 'near-ai' ? nearAi : mock),
    },
  ],
  exports: [AutomationService],
})
export class AutomationModule {}
