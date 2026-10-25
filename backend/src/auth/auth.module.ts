import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AUTH_STORE, NEP413_VERIFIER } from './auth.types.js';
import { NearNep413Verifier } from './near-nep413.verifier.js';
import { PrismaAuthStore } from './prisma-auth.store.js';
import {
  CsrfGuard,
  OrganizationPermissionGuard,
  SessionGuard,
} from './auth.guards.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PrismaAuthStore,
    NearNep413Verifier,
    SessionGuard,
    CsrfGuard,
    OrganizationPermissionGuard,
    { provide: AUTH_STORE, useExisting: PrismaAuthStore },
    { provide: NEP413_VERIFIER, useExisting: NearNep413Verifier },
  ],
  exports: [AuthService, SessionGuard, CsrfGuard, OrganizationPermissionGuard],
})
export class AuthModule {}
