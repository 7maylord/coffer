import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  PayrollBatchStatus,
  PayrollPayoutItemStatus,
  PayrollPayoutRunStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import {
  PayrollError,
  type PayrollStore,
  type StoredPayrollBatch,
} from './payroll.types.js';

@Injectable()
export class PrismaPayrollStore implements PayrollStore, OnModuleDestroy {
  private readonly prisma: PrismaClient;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.prisma = new PrismaClient({
      datasourceUrl: environment.DATABASE_URL,
      log: [],
      errorFormat: 'minimal',
    });
  }

  async createBatch(input: Parameters<PayrollStore['createBatch']>[0]) {
    try {
      const batchId = await this.prisma.$transaction(async (tx) => {
        const userIds = input.lines.map(({ userId }) => userId);
        const codes = input.lines.map(({ employeeCode }) => employeeCode);
        const memberships = await tx.membership.findMany({
          where: {
            organizationId: input.organizationId,
            userId: { in: userIds },
            role: 'EMPLOYEE',
            revokedAt: null,
          },
          select: { userId: true },
        });
        if (memberships.length !== userIds.length) {
          throw invalidImport('Every payroll user must be an active employee');
        }
        const existing = await tx.employeeProfile.findMany({
          where: {
            organizationId: input.organizationId,
            OR: [{ employeeCode: { in: codes } }, { userId: { in: userIds } }],
          },
          select: { id: true, employeeCode: true, userId: true },
        });
        if (
          existing.some((profile) => {
            const line = input.lines.find(
              (candidate) =>
                candidate.employeeCode === profile.employeeCode ||
                candidate.userId === profile.userId,
            );
            return (
              !line ||
              line.employeeCode !== profile.employeeCode ||
              line.userId !== profile.userId
            );
          })
        ) {
          throw invalidImport('Employee code and user mappings are immutable');
        }
        const batch = await tx.payrollBatch.create({
          data: {
            organizationId: input.organizationId,
            reference: input.reference,
            status: PayrollBatchStatus.DRAFT,
            currency: input.assetId,
            isSynthetic: true,
            schemaVersion: 1,
            manifestDigest: input.manifestDigest,
            totalGrossAtomic: new Prisma.Decimal(input.totalGrossAtomic),
            totalNetAtomic: new Prisma.Decimal(input.totalNetAtomic),
            lineCount: input.lines.length,
            perEmployeeCapAtomic: new Prisma.Decimal(
              input.perEmployeeCapAtomic,
            ),
            batchCapAtomic: new Prisma.Decimal(input.batchCapAtomic),
            wrappedDataKey: bytes(input.wrappedDataKey),
            dataKeyNonce: bytes(input.dataKeyNonce),
            encryptionKeyVersion: input.encryptionKeyVersion,
          },
          select: { id: true },
        });
        for (const line of input.lines) {
          const employee = await tx.employeeProfile.upsert({
            where: {
              organizationId_employeeCode: {
                organizationId: input.organizationId,
                employeeCode: line.employeeCode,
              },
            },
            update: { isSynthetic: true },
            create: {
              organizationId: input.organizationId,
              userId: line.userId,
              employeeCode: line.employeeCode,
              displayName: line.employeeCode,
              isSynthetic: true,
            },
            select: { id: true },
          });
          await tx.payrollLine.create({
            data: {
              organizationId: input.organizationId,
              batchId: batch.id,
              employeeId: employee.id,
              salaryCiphertext: bytes(line.salaryCiphertext),
              salaryNonce: bytes(line.salaryNonce),
              netCiphertext: bytes(line.netCiphertext),
              netNonce: bytes(line.netNonce),
              profileCiphertext: bytes(line.profileCiphertext),
              profileNonce: bytes(line.profileNonce),
              amountCommitment: line.amountCommitment,
              lineDigest: line.lineDigest,
              encryptionKeyVersion: line.encryptionKeyVersion,
            },
          });
        }
        await tx.auditEvent.create({
          data: {
            organizationId: input.organizationId,
            actorId: input.actorUserId,
            eventType: 'PAYROLL_SYNTHETIC_IMPORT_CREATED',
            entityType: 'PAYROLL_BATCH',
            entityId: batch.id,
            correlationId: randomUUID(),
            metadata: {
              manifestDigest: input.manifestDigest,
              lineCount: input.lines.length,
              synthetic: true,
            },
          },
        });
        return batch.id;
      });
      return this.requireBatch(input.organizationId, batchId);
    } catch (error) {
      if (known(error, 'P2002')) {
        throw new PayrollError(
          'PAYROLL_DUPLICATE',
          'Payroll reference or employee row already exists',
        );
      }
      throw error;
    }
  }

  async batches(organizationId: string) {
    const batches = await this.prisma.payrollBatch.findMany({
      where: { organizationId, schemaVersion: 1 },
      include: {
        lines: { include: { employee: true }, orderBy: { id: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return batches.map(mapBatch);
  }

  async batch(organizationId: string, batchId: string) {
    const batch = await this.prisma.payrollBatch.findFirst({
      where: { id: batchId, organizationId, schemaVersion: 1 },
      include: {
        lines: { include: { employee: true }, orderBy: { id: 'asc' } },
      },
    });
    return batch ? mapBatch(batch) : null;
  }

  async approveBatch(input: Parameters<PayrollStore['approveBatch']>[0]) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payrollBatch.updateMany({
        where: {
          id: input.batchId,
          organizationId: input.organizationId,
          schemaVersion: 1,
          status: PayrollBatchStatus.DRAFT,
          manifestDigest: input.expectedManifestDigest,
          version: input.expectedVersion,
        },
        data: {
          status: PayrollBatchStatus.APPROVED,
          approvedManifestDigest: input.expectedManifestDigest,
          approvedByUserId: input.actorUserId,
          approvedAt: input.now,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) return null;
      await tx.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorId: input.actorUserId,
          eventType: 'PAYROLL_MANIFEST_APPROVED',
          entityType: 'PAYROLL_BATCH',
          entityId: input.batchId,
          correlationId: randomUUID(),
          metadata: { manifestDigest: input.expectedManifestDigest },
        },
      });
      const batch = await tx.payrollBatch.findFirstOrThrow({
        where: { id: input.batchId, organizationId: input.organizationId },
        include: {
          lines: { include: { employee: true }, orderBy: { id: 'asc' } },
        },
      });
      return mapBatch(batch);
    });
  }

  async payoutRun(organizationId: string, batchId: string) {
    const run = await this.prisma.payrollPayoutRun.findUnique({
      where: { organizationId_batchId: { organizationId, batchId } },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    return run ? mapPayoutRun(run) : null;
  }

  async createPayoutRun(input: Parameters<PayrollStore['createPayoutRun']>[0]) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const batch = await tx.payrollBatch.findFirst({
          where: {
            id: input.batchId,
            organizationId: input.organizationId,
            status: PayrollBatchStatus.APPROVED,
            manifestDigest: input.approvedManifestDigest,
            approvedManifestDigest: input.approvedManifestDigest,
            version: input.approvedBatchVersion,
          },
          select: { id: true },
        });
        if (!batch) {
          throw new PayrollError(
            'PAYROLL_PAYOUT_NOT_READY',
            'Approved payroll manifest changed before payout preparation',
          );
        }
        const run = await tx.payrollPayoutRun.create({
          data: {
            organizationId: input.organizationId,
            batchId: input.batchId,
            createdByUserId: input.actorUserId,
            signerAccountId: input.signerAccountId,
            idempotencyKey: input.idempotencyKey,
            requestDigest: input.requestDigest,
            approvedManifestDigest: input.approvedManifestDigest,
            approvedBatchVersion: input.approvedBatchVersion,
            items: {
              create: input.items.map((item) => ({
                organizationId: input.organizationId,
                payrollLineId: item.payrollLineId,
                instructionDigest: item.instructionDigest,
              })),
            },
          },
          include: { items: { orderBy: { id: 'asc' } } },
        });
        await tx.auditEvent.create({
          data: {
            organizationId: input.organizationId,
            actorId: input.actorUserId,
            eventType: 'PAYROLL_PAYOUT_PREPARED',
            entityType: 'PAYROLL_PAYOUT',
            entityId: run.id,
            correlationId: randomUUID(),
            metadata: {
              batchId: input.batchId,
              approvedManifestDigest: input.approvedManifestDigest,
              itemCount: input.items.length,
            },
          },
        });
        return mapPayoutRun(run);
      });
    } catch (error) {
      if (known(error, 'P2002')) {
        const existing = await this.payoutRun(
          input.organizationId,
          input.batchId,
        );
        if (
          existing?.idempotencyKey === input.idempotencyKey &&
          existing.requestDigest === input.requestDigest
        ) {
          return existing;
        }
        throw new PayrollError(
          'PAYROLL_PAYOUT_CONFLICT',
          'Payout idempotency key or batch is already in use',
        );
      }
      throw error;
    }
  }

  async verifyPayoutItem(
    input: Parameters<PayrollStore['verifyPayoutItem']>[0],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "PayrollPayoutRun" WHERE "id" = ${input.payoutRunId}::uuid AND "organizationId" = ${input.organizationId}::uuid FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "PayrollPayoutItem" WHERE "id" = ${input.payoutItemId}::uuid AND "organizationId" = ${input.organizationId}::uuid AND "payoutRunId" = ${input.payoutRunId}::uuid FOR UPDATE`,
      );
      const current = await tx.payrollPayoutItem.findFirst({
        where: {
          id: input.payoutItemId,
          organizationId: input.organizationId,
          payoutRunId: input.payoutRunId,
        },
      });
      if (!current) return null;
      if (current.status === PayrollPayoutItemStatus.VERIFIED) {
        if (current.transactionHash !== input.transactionHash) return null;
      } else {
        await tx.payrollPayoutItem.update({
          where: { id: current.id },
          data: {
            status: PayrollPayoutItemStatus.VERIFIED,
            transactionHash: input.transactionHash,
            evidenceDigest: input.evidenceDigest,
            verifiedAt: input.verifiedAt,
          },
        });
        await tx.auditEvent.create({
          data: {
            organizationId: input.organizationId,
            actorId: input.actorUserId,
            eventType: 'PAYROLL_PAYOUT_TRANSFER_VERIFIED',
            entityType: 'PAYROLL_PAYOUT_ITEM',
            entityId: current.id,
            correlationId: randomUUID(),
            metadata: {
              payoutRunId: input.payoutRunId,
              transactionHash: input.transactionHash,
              evidenceDigest: input.evidenceDigest,
            },
          },
        });
      }
      const pending = await tx.payrollPayoutItem.count({
        where: {
          payoutRunId: input.payoutRunId,
          organizationId: input.organizationId,
          status: PayrollPayoutItemStatus.PREPARED,
        },
      });
      const run = await tx.payrollPayoutRun.findFirstOrThrow({
        where: {
          id: input.payoutRunId,
          organizationId: input.organizationId,
        },
        select: { batchId: true, status: true },
      });
      if (run.status === PayrollPayoutRunStatus.PREPARED) {
        await tx.payrollPayoutRun.update({
          where: { id: input.payoutRunId },
          data: { status: PayrollPayoutRunStatus.PROCESSING },
        });
        await tx.payrollBatch.updateMany({
          where: {
            id: run.batchId,
            organizationId: input.organizationId,
            status: PayrollBatchStatus.APPROVED,
          },
          data: { status: PayrollBatchStatus.PROCESSING },
        });
      }
      if (pending === 0) {
        await tx.payrollPayoutRun.update({
          where: { id: input.payoutRunId },
          data: {
            status: PayrollPayoutRunStatus.SETTLED,
            settledAt: input.verifiedAt,
          },
        });
        await tx.payrollBatch.updateMany({
          where: {
            id: run.batchId,
            organizationId: input.organizationId,
            status: PayrollBatchStatus.PROCESSING,
          },
          data: { status: PayrollBatchStatus.SETTLED },
        });
      }
      const updated = await tx.payrollPayoutRun.findUniqueOrThrow({
        where: { id: input.payoutRunId },
        include: { items: { orderBy: { id: 'asc' } } },
      });
      return mapPayoutRun(updated);
    });
  }

  async payslipForUser(userId: string, lineId: string) {
    const line = await this.prisma.payrollLine.findFirst({
      where: {
        id: lineId,
        employee: { userId },
      },
      include: {
        employee: true,
        batch: true,
      },
    });
    if (!line) return null;
    const active = await this.prisma.membership.count({
      where: {
        organizationId: line.organizationId,
        userId,
        role: 'EMPLOYEE',
        revokedAt: null,
      },
    });
    if (active !== 1) return null;
    return mapBatch({ ...line.batch, lines: [line] });
  }

  async payslipsForUser(userId: string) {
    const lines = await this.prisma.payrollLine.findMany({
      where: {
        employee: {
          userId,
          organization: {
            memberships: {
              some: { userId, role: 'EMPLOYEE', revokedAt: null },
            },
          },
        },
      },
      include: { employee: true, batch: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return lines.map((line) => mapBatch({ ...line.batch, lines: [line] }));
  }

  async auditDeniedPayslipAccess(userId: string, lineId: string) {
    const line = await this.prisma.payrollLine.findUnique({
      where: { id: lineId },
      select: { organizationId: true },
    });
    if (!line) return;
    await this.prisma.auditEvent.create({
      data: {
        organizationId: line.organizationId,
        actorId: userId,
        eventType: 'PAYSLIP_ACCESS_DENIED',
        entityType: 'PAYSLIP',
        entityId: lineId,
        correlationId: randomUUID(),
        metadata: { reason: 'SELF_SCOPE_MISMATCH' },
      },
    });
  }

  async recordSensitiveRead(
    input: Parameters<PayrollStore['recordSensitiveRead']>[0],
  ) {
    await this.prisma.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.actorUserId,
        eventType: input.eventType,
        entityType: input.entityType,
        entityId: input.entityId,
        correlationId: randomUUID(),
        metadata: input.purpose ? { purpose: input.purpose } : {},
      },
    });
  }

  async recordAnalysis(input: Parameters<PayrollStore['recordAnalysis']>[0]) {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.payrollAnalysisRun.create({
        data: {
          organizationId: input.organizationId,
          batchId: input.batchId,
          actorUserId: input.actorUserId,
          mode: input.mode,
          provider: input.provider,
          model: input.model,
          inputDigest: input.inputDigest,
          responseDigest: input.responseDigest,
          attestationStatus: input.attestationStatus,
          status: input.status,
          findings: input.findings as unknown as Prisma.InputJsonValue,
          errorCode: input.errorCode,
          providerRequestId: input.providerRequestId,
          promptTemplateVersion: 'payroll-anomaly-v1',
          inputClassification: 'RESTRICTED_PAYROLL',
        },
        select: { id: true },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorId: input.actorUserId,
          eventType: 'PAYROLL_ANALYSIS_ATTESTATION_OUTCOME',
          entityType: 'PAYROLL_ANALYSIS',
          entityId: run.id,
          correlationId: randomUUID(),
          metadata: {
            mode: input.mode,
            provider: input.provider,
            attestationStatus: input.attestationStatus,
            status: input.status,
            errorCode: input.errorCode ?? null,
          },
        },
      });
      return run;
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  private async requireBatch(organizationId: string, batchId: string) {
    const batch = await this.batch(organizationId, batchId);
    if (!batch) {
      throw new PayrollError(
        'PAYROLL_NOT_FOUND',
        'Payroll batch was not found',
      );
    }
    return batch;
  }
}

type BatchPayload = Prisma.PayrollBatchGetPayload<{
  include: { lines: { include: { employee: true } } };
}>;

type PayoutRunPayload = Prisma.PayrollPayoutRunGetPayload<{
  include: { items: true };
}>;

function mapPayoutRun(value: PayoutRunPayload) {
  return {
    id: value.id,
    organizationId: value.organizationId,
    batchId: value.batchId,
    status: value.status,
    signerAccountId: value.signerAccountId,
    idempotencyKey: value.idempotencyKey,
    requestDigest: value.requestDigest,
    approvedManifestDigest: value.approvedManifestDigest,
    approvedBatchVersion: value.approvedBatchVersion,
    settledAt: value.settledAt,
    items: value.items.map((item) => ({
      id: item.id,
      organizationId: item.organizationId,
      payoutRunId: item.payoutRunId,
      payrollLineId: item.payrollLineId,
      status: item.status,
      instructionDigest: item.instructionDigest,
      transactionHash: item.transactionHash,
      evidenceDigest: item.evidenceDigest,
      verifiedAt: item.verifiedAt,
    })),
  };
}

function mapBatch(value: BatchPayload): StoredPayrollBatch {
  return {
    id: value.id,
    organizationId: value.organizationId,
    reference: value.reference,
    status: value.status,
    assetId: value.currency,
    manifestDigest: value.manifestDigest,
    totalGrossAtomic: value.totalGrossAtomic.toFixed(0),
    totalNetAtomic: value.totalNetAtomic.toFixed(0),
    lineCount: value.lineCount,
    perEmployeeCapAtomic: value.perEmployeeCapAtomic.toFixed(0),
    batchCapAtomic: value.batchCapAtomic.toFixed(0),
    wrappedDataKey: Buffer.from(value.wrappedDataKey),
    dataKeyNonce: Buffer.from(value.dataKeyNonce),
    encryptionKeyVersion: value.encryptionKeyVersion,
    calculationAssumption: 'SYNTHETIC_NO_TAX',
    approvedManifestDigest: value.approvedManifestDigest,
    approvedByUserId: value.approvedByUserId,
    approvedAt: value.approvedAt,
    version: value.version,
    createdAt: value.createdAt,
    lines: value.lines.map((line) => ({
      id: line.id,
      organizationId: line.organizationId,
      batchId: line.batchId,
      employeeId: line.employeeId,
      employeeCode: line.employee.employeeCode,
      userId: line.employee.userId,
      salaryCiphertext: Buffer.from(line.salaryCiphertext),
      salaryNonce: Buffer.from(line.salaryNonce),
      netCiphertext: Buffer.from(line.netCiphertext),
      netNonce: Buffer.from(line.netNonce),
      profileCiphertext: Buffer.from(line.profileCiphertext),
      profileNonce: Buffer.from(line.profileNonce),
      amountCommitment: line.amountCommitment,
      lineDigest: line.lineDigest,
      encryptionKeyVersion: line.encryptionKeyVersion,
    })),
  };
}

function invalidImport(message: string) {
  return new PayrollError('PAYROLL_INVALID_IMPORT', message);
}

function known(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

function bytes(value: Buffer): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}
