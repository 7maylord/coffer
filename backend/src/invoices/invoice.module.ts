import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TreasuryModule } from '../treasury/treasury.module.js';
import {
  InvoiceController,
  PublicInvoiceController,
} from './invoice.controller.js';
import { InvoiceService } from './invoice.service.js';
import { INVOICE_STORE } from './invoice.types.js';
import { PrismaInvoiceStore } from './prisma-invoice.store.js';
import { SettlementModule } from '../settlement/settlement.module.js';

@Module({
  imports: [AuthModule, TreasuryModule, SettlementModule],
  controllers: [InvoiceController, PublicInvoiceController],
  providers: [
    InvoiceService,
    PrismaInvoiceStore,
    { provide: INVOICE_STORE, useExisting: PrismaInvoiceStore },
  ],
  exports: [InvoiceService],
})
export class InvoiceModule {}
