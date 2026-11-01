import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OperationsController } from './operations.controller.js';
import { PrismaOperationsStore } from './prisma-operations.store.js';

@Module({
  imports: [AuthModule],
  controllers: [OperationsController],
  providers: [PrismaOperationsStore],
  exports: [PrismaOperationsStore],
})
export class OperationsModule {}
