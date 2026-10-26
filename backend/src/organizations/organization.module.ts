import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrganizationController } from './organization.controller.js';
import { OrganizationService } from './organization.service.js';
import { PrismaOrganizationStore } from './prisma-organization.store.js';
import { ORGANIZATION_STORE } from './organization.types.js';

@Module({
  imports: [AuthModule],
  controllers: [OrganizationController],
  providers: [
    OrganizationService,
    PrismaOrganizationStore,
    { provide: ORGANIZATION_STORE, useExisting: PrismaOrganizationStore },
  ],
})
export class OrganizationModule {}
