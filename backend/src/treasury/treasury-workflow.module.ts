import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PolicyModule } from '../policy/policy.module.js';
import { TreasuryModule } from './treasury.module.js';
import { TreasuryWorkflowController } from './treasury-workflow.controller.js';
import { TreasuryWorkflowService } from './treasury-workflow.service.js';

@Module({
  imports: [AuthModule, TreasuryModule, PolicyModule],
  controllers: [TreasuryWorkflowController],
  providers: [TreasuryWorkflowService],
})
export class TreasuryWorkflowModule {}
