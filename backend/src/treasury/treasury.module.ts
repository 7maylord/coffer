import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { AssetRegistry } from './asset-registry.js';
import { LedgerService } from './ledger.service.js';
import { LEDGER_STORE, type LedgerStore } from './ledger.types.js';
import { PrismaLedgerStore } from './prisma-ledger.store.js';

@Module({
  imports: [ConfigModule],
  providers: [
    AssetRegistry,
    PrismaLedgerStore,
    { provide: LEDGER_STORE, useExisting: PrismaLedgerStore },
    {
      provide: LedgerService,
      inject: [LEDGER_STORE, AssetRegistry],
      useFactory: (store: LedgerStore, assets: AssetRegistry) =>
        new LedgerService(store, assets),
    },
  ],
  exports: [LedgerService, AssetRegistry],
})
export class TreasuryModule {}
