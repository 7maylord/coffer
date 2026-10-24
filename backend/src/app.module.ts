import { APP_FILTER } from '@nestjs/core';
import { correlationId, SafeExceptionFilter } from './http/request-safety.js';
import {
  Module,
  type NestModule,
  type MiddlewareConsumer,
} from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { SettlementModule } from './settlement/settlement.module.js';
import { HealthController } from './health/health.controller.js';
import { HealthDependencies, HealthService } from './health/health.service.js';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import { OrganizationModule } from './organizations/organization.module.js';
import { TreasuryModule } from './treasury/treasury.module.js';
import { PolicyModule } from './policy/policy.module.js';
import { InvoiceModule } from './invoices/invoice.module.js';
import { AutomationModule } from './automation/automation.module.js';
import { PayrollModule } from './payroll/payroll.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { TreasuryWorkflowModule } from './treasury/treasury-workflow.module.js';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    OrganizationModule,
    TreasuryModule,
    PolicyModule,
    SettlementModule,
    InvoiceModule,
    AutomationModule,
    PayrollModule,
    OperationsModule,
    TreasuryWorkflowModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    HealthDependencies,
    HealthService,
    { provide: APP_FILTER, useClass: SafeExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(correlationId).forRoutes('*');
  }
}
