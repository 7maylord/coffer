import { Module } from '@nestjs/common';
import { MockSettlementAdapter } from './mock-settlement.adapter.js';
import { SettlementController } from './settlement.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { TreasuryModule } from '../treasury/treasury.module.js';
import { PrismaSettlementStore } from './prisma-settlement.store.js';
import { SettlementService } from './settlement.service.js';
import {
  SETTLEMENT_OPERATIONS,
  type SettlementOperations,
} from './settlement.store.js';
import { SettlementOutboxProcessor } from './settlement-outbox.processor.js';
import { NearIntents1ClickAdapter } from './near-intents-1click.adapter.js';
import {
  NEAR_TRANSFER_EVIDENCE_STORE,
  NearTestnetTransferAdapter,
} from './near-testnet-transfer.adapter.js';
import { PrismaNearTransferEvidenceStore } from './prisma-near-transfer-evidence.store.js';
import { IntentsSwapController } from './intents-swap.controller.js';
import {
  INTENTS_SWAP_STORE,
  IntentsSwapService,
} from './intents-swap.service.js';
import { PrismaIntentsSwapStore } from './prisma-intents-swap.store.js';

@Module({
  imports: [AuthModule, TreasuryModule],
  controllers: [SettlementController, IntentsSwapController],
  providers: [
    MockSettlementAdapter,
    NearIntents1ClickAdapter,
    NearTestnetTransferAdapter,
    PrismaNearTransferEvidenceStore,
    PrismaIntentsSwapStore,
    IntentsSwapService,
    {
      provide: INTENTS_SWAP_STORE,
      useExisting: PrismaIntentsSwapStore,
    },
    {
      provide: NEAR_TRANSFER_EVIDENCE_STORE,
      useExisting: PrismaNearTransferEvidenceStore,
    },
    PrismaSettlementStore,
    {
      provide: SettlementService,
      inject: [
        PrismaSettlementStore,
        MockSettlementAdapter,
        NearTestnetTransferAdapter,
      ],
      useFactory: (
        store: PrismaSettlementStore,
        mock: MockSettlementAdapter,
        transfers: NearTestnetTransferAdapter,
      ): SettlementOperations =>
        new SettlementService(store, mock, undefined, transfers),
    },
    {
      provide: SETTLEMENT_OPERATIONS,
      useExisting: SettlementService,
    },
    SettlementOutboxProcessor,
  ],
  exports: [
    SETTLEMENT_OPERATIONS,
    SettlementOutboxProcessor,
    NearIntents1ClickAdapter,
    NearTestnetTransferAdapter,
  ],
})
export class SettlementModule {}
