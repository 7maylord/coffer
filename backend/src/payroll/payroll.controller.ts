import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  type AuthenticatedRequest,
  CsrfGuard,
  OrganizationPermissionGuard,
  RequireOrganizationPermission,
  requestPrincipal,
  SessionGuard,
} from '../auth/auth.guards.js';
import { PayrollService } from './payroll.service.js';
import { PayrollError } from './payroll.types.js';
import { ProviderAdapterError } from '../settlement/provider-adapter.types.js';

const atomic = z.string().regex(/^[1-9][0-9]{0,77}$/);
const importSchema = z
  .object({
    reference: z.string().trim().min(1).max(64),
    assetId: z.string().min(1).max(192),
    synthetic: z.literal(true),
    perEmployeeCapAtomic: atomic,
    batchCapAtomic: atomic,
    csv: z.string().min(1).max(256_000),
  })
  .strict();
const approvalSchema = z
  .object({
    expectedManifestDigest: z.string().regex(/^[0-9a-f]{64}$/),
    expectedVersion: z.number().int().min(1),
  })
  .strict();
const analysisSchema = z
  .object({ mode: z.enum(['deterministic', 'private-ai']) })
  .strict();
const payoutPreparationSchema = z
  .object({
    signerAccountId: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  })
  .strict();
const payoutEvidenceSchema = z
  .object({
    transactionHash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/),
  })
  .strict();
const uuid = z.string().uuid();
const importOpenApi: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'reference',
    'assetId',
    'synthetic',
    'perEmployeeCapAtomic',
    'batchCapAtomic',
    'csv',
  ],
  properties: {
    reference: { type: 'string', minLength: 1, maxLength: 64 },
    assetId: { type: 'string', minLength: 1, maxLength: 192 },
    synthetic: { type: 'boolean', enum: [true] },
    perEmployeeCapAtomic: { type: 'string', pattern: '^[1-9][0-9]{0,77}$' },
    batchCapAtomic: { type: 'string', pattern: '^[1-9][0-9]{0,77}$' },
    csv: { type: 'string', maxLength: 256000 },
  },
};
const approvalOpenApi: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedManifestDigest', 'expectedVersion'],
  properties: {
    expectedManifestDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    expectedVersion: { type: 'integer', minimum: 1 },
  },
};
const analysisOpenApi: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['mode'],
  properties: {
    mode: { type: 'string', enum: ['deterministic', 'private-ai'] },
  },
};
const payoutPreparationOpenApi: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['signerAccountId'],
  properties: {
    signerAccountId: { type: 'string', minLength: 2, maxLength: 64 },
  },
};
const payoutEvidenceOpenApi: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['transactionHash'],
  properties: {
    transactionHash: { type: 'string', minLength: 43, maxLength: 44 },
  },
};
const payoutRunOpenApi: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'batchId',
    'status',
    'signerAccountId',
    'approvedManifestDigest',
    'settledAt',
    'items',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    batchId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: ['PREPARED', 'PROCESSING', 'SETTLED'] },
    signerAccountId: { type: 'string' },
    approvedManifestDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    settledAt: {
      oneOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'id',
          'payrollLineId',
          'status',
          'transactionHash',
          'evidenceDigest',
          'verifiedAt',
          'transaction',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          payrollLineId: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['PREPARED', 'VERIFIED'] },
          transactionHash: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          evidenceDigest: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          verifiedAt: {
            oneOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
          },
          transaction: { oneOf: [{ type: 'object' }, { type: 'null' }] },
        },
      },
    },
  },
};
const payrollSummaryOpenApi: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'organizationId',
    'reference',
    'status',
    'assetId',
    'manifestDigest',
    'totalGrossAtomic',
    'totalNetAtomic',
    'lineCount',
    'calculationAssumption',
    'approvedManifestDigest',
    'approvedAt',
    'version',
    'confidentiality',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    reference: { type: 'string' },
    status: {
      type: 'string',
      enum: ['DRAFT', 'REVIEW', 'APPROVED', 'PROCESSING', 'SETTLED', 'FAILED'],
    },
    assetId: { type: 'string' },
    manifestDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    totalGrossAtomic: { type: 'string', pattern: '^\\d+$' },
    totalNetAtomic: { type: 'string', pattern: '^\\d+$' },
    lineCount: { type: 'integer' },
    calculationAssumption: { type: 'string', enum: ['SYNTHETIC_NO_TAX'] },
    approvedManifestDigest: {
      oneOf: [{ type: 'string', pattern: '^[0-9a-f]{64}$' }, { type: 'null' }],
    },
    approvedAt: {
      oneOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
    },
    version: { type: 'integer' },
    confidentiality: { type: 'string' },
  },
};
const payrollLineOpenApi: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'employeeCode',
    'userId',
    'grossAmountAtomic',
    'netAmountAtomic',
    'profile',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    employeeCode: { type: 'string' },
    userId: { oneOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
    grossAmountAtomic: { type: 'string', pattern: '^\\d+$' },
    netAmountAtomic: { type: 'string', pattern: '^\\d+$' },
    profile: {
      type: 'object',
      required: ['legalName', 'address', 'payoutAccount'],
      properties: {
        legalName: { type: 'string' },
        address: { type: 'string' },
        payoutAccount: { type: 'string' },
      },
    },
  },
};
const payrollBatchOpenApi: SchemaObject = {
  ...payrollSummaryOpenApi,
  required: [...(payrollSummaryOpenApi.required ?? []), 'lines'],
  properties: {
    ...payrollSummaryOpenApi.properties,
    lines: { type: 'array', items: payrollLineOpenApi },
  },
};
const payslipOpenApi: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'batchId',
    'reference',
    'status',
    'assetId',
    'employeeCode',
    'legalName',
    'address',
    'payoutAccount',
    'grossAmountAtomic',
    'netAmountAtomic',
    'calculationAssumption',
    'confidentiality',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    batchId: { type: 'string', format: 'uuid' },
    reference: { type: 'string' },
    status: {
      type: 'string',
      enum: ['DRAFT', 'REVIEW', 'APPROVED', 'PROCESSING', 'SETTLED', 'FAILED'],
    },
    assetId: { type: 'string' },
    employeeCode: { type: 'string' },
    legalName: { type: 'string' },
    address: { type: 'string' },
    payoutAccount: { type: 'string' },
    grossAmountAtomic: { type: 'string', pattern: '^\\d+$' },
    netAmountAtomic: { type: 'string', pattern: '^\\d+$' },
    calculationAssumption: { type: 'string', enum: ['SYNTHETIC_NO_TAX'] },
    confidentiality: { type: 'string' },
  },
};
const analysisResponseOpenApi: SchemaObject = {
  type: 'object',
  required: ['id', 'mode', 'findings', 'attestationStatus', 'confidentiality'],
  properties: {
    id: { type: 'string' },
    mode: { type: 'string', enum: ['deterministic', 'private-ai'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['lineId', 'code', 'severity', 'explanation'],
        properties: {
          lineId: { type: 'string', format: 'uuid' },
          code: {
            type: 'string',
            enum: ['ABOVE_2X_MEDIAN', 'DUPLICATE_AMOUNT', 'REVIEW_RECOMMENDED'],
          },
          severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          explanation: { type: 'string' },
        },
      },
    },
    attestationStatus: {
      type: 'string',
      enum: ['NOT_REQUESTED', 'VERIFIED_PROVIDER_TEE'],
    },
    confidentiality: { type: 'string' },
  },
};

@ApiTags('payroll')
@ApiCookieAuth('coffer_session')
@UseGuards(SessionGuard, CsrfGuard, OrganizationPermissionGuard)
@Controller('v1/orgs/:orgId/payroll')
export class PayrollController {
  constructor(
    @Inject(PayrollService) private readonly payroll: PayrollService,
  ) {}

  @Post('imports')
  @RequireOrganizationPermission('payroll:import')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiBody({ schema: importOpenApi })
  @ApiOperation({ summary: 'Import a strict synthetic encrypted payroll CSV' })
  @ApiResponse({ status: 201, schema: payrollSummaryOpenApi })
  importPayroll(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Body() body: unknown,
  ) {
    return this.execute(() =>
      this.payroll.importSynthetic(
        organizationId,
        requestPrincipal(request).userId,
        importSchema.parse(body),
      ),
    );
  }

  @Get('batches')
  @RequireOrganizationPermission('payroll:read')
  @ApiOperation({ summary: 'List bounded payroll batch summaries' })
  @ApiResponse({
    status: 200,
    schema: { type: 'array', items: payrollSummaryOpenApi },
  })
  batches(@Param('orgId') organizationId: string) {
    return this.payroll.batches(organizationId);
  }

  @Get('batches/:batchId')
  @RequireOrganizationPermission('payroll:read')
  @ApiParam({ name: 'batchId', type: String })
  @ApiOperation({ summary: 'Read and audit a finance-scoped payroll batch' })
  @ApiResponse({ status: 200, schema: payrollBatchOpenApi })
  batch(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Param('batchId') batchId: string,
  ) {
    return this.execute(() =>
      this.payroll.batch(
        organizationId,
        uuid.parse(batchId),
        requestPrincipal(request).userId,
      ),
    );
  }

  @Get('batches/:batchId/audit')
  @RequireOrganizationPermission('payroll:audit')
  @ApiHeader({ name: 'X-Audit-Purpose', required: true })
  @ApiOperation({
    summary: 'Read a purpose-limited redacted payroll audit view',
  })
  auditView(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Param('batchId') batchId: string,
    @Headers('x-audit-purpose') purpose: string | undefined,
  ) {
    return this.execute(() =>
      this.payroll.auditView(
        organizationId,
        uuid.parse(batchId),
        requestPrincipal(request).userId,
        purpose ?? '',
      ),
    );
  }

  @Post('batches/:batchId/approve')
  @RequireOrganizationPermission('payroll:approve')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiBody({ schema: approvalOpenApi })
  @ApiOperation({ summary: 'Approve the exact immutable payroll manifest' })
  @ApiResponse({ status: 201, schema: payrollSummaryOpenApi })
  approve(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Param('batchId') batchId: string,
    @Body() body: unknown,
  ) {
    return this.execute(() => {
      const value = approvalSchema.parse(body);
      return this.payroll.approve(
        organizationId,
        uuid.parse(batchId),
        requestPrincipal(request).userId,
        value.expectedManifestDigest,
        value.expectedVersion,
      );
    });
  }

  @Post('batches/:batchId/analysis')
  @RequireOrganizationPermission('payroll:analyze')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiBody({ schema: analysisOpenApi })
  @ApiOperation({
    summary: 'Run deterministic or strictly verified payroll analysis',
  })
  @ApiResponse({ status: 201, schema: analysisResponseOpenApi })
  analyze(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Param('batchId') batchId: string,
    @Body() body: unknown,
  ) {
    return this.execute(() =>
      this.payroll.analyze(
        organizationId,
        uuid.parse(batchId),
        requestPrincipal(request).userId,
        analysisSchema.parse(body).mode,
      ),
    );
  }

  @Post('batches/:batchId/payouts')
  @RequireOrganizationPermission('payroll:payout')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: payoutPreparationOpenApi })
  @ApiOperation({
    summary: 'Prepare exact wallet-signed testnet payroll transactions',
  })
  @ApiResponse({ status: 201, schema: payoutRunOpenApi })
  preparePayout(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Param('batchId') batchId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    return this.execute(() => {
      const value = payoutPreparationSchema.parse(body);
      return this.payroll.preparePayout(
        organizationId,
        uuid.parse(batchId),
        requestPrincipal(request).userId,
        value.signerAccountId,
        key ?? '',
      );
    });
  }

  @Post('batches/:batchId/payouts/items/:itemId/reconcile')
  @RequireOrganizationPermission('payroll:payout')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiBody({ schema: payoutEvidenceOpenApi })
  @ApiOperation({
    summary: 'Verify one final testnet payroll transfer against chain RPC',
  })
  @ApiResponse({ status: 201, schema: payoutRunOpenApi })
  reconcilePayoutItem(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Param('batchId') batchId: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    return this.execute(() => {
      const value = payoutEvidenceSchema.parse(body);
      return this.payroll.reconcilePayoutItem(
        organizationId,
        uuid.parse(batchId),
        uuid.parse(itemId),
        requestPrincipal(request).userId,
        value.transactionHash,
      );
    });
  }

  private async execute<T>(operation: () => T | Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof z.ZodError) throw new BadRequestException();
      if (error instanceof PayrollError) {
        if (
          error.code === 'PAYROLL_NOT_FOUND' ||
          error.code === 'PAYROLL_PAYOUT_NOT_FOUND'
        )
          throw new NotFoundException();
        if (error.code === 'PAYROLL_ACCESS_DENIED')
          throw new ForbiddenException();
        if (
          error.code === 'PRIVATE_AI_DISABLED' ||
          error.code === 'PRIVATE_AI_UNAVAILABLE' ||
          error.code === 'PAYROLL_ENCRYPTION_UNAVAILABLE' ||
          error.code === 'PAYROLL_PAYOUT_DISABLED'
        ) {
          throw new ServiceUnavailableException();
        }
        if (
          error.code === 'PAYROLL_DUPLICATE' ||
          error.code === 'PAYROLL_MANIFEST_MISMATCH' ||
          error.code === 'PAYROLL_NOT_APPROVABLE' ||
          error.code === 'PAYROLL_PAYOUT_NOT_READY' ||
          error.code === 'PAYROLL_PAYOUT_CONFLICT'
        ) {
          throw new ConflictException();
        }
        throw new BadRequestException();
      }
      if (error instanceof ProviderAdapterError) {
        if (error.code === 'PROVIDER_UNAVAILABLE') {
          throw new ServiceUnavailableException();
        }
        throw new ConflictException();
      }
      throw error;
    }
  }
}

@ApiTags('payslips')
@ApiCookieAuth('coffer_session')
@UseGuards(SessionGuard, CsrfGuard)
@Controller('v1/me/payslips')
export class PayslipController {
  constructor(
    @Inject(PayrollService) private readonly payroll: PayrollService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List only the authenticated employee own payslips',
  })
  @ApiResponse({
    status: 200,
    schema: { type: 'array', items: payslipOpenApi },
  })
  payslips(@Req() request: AuthenticatedRequest) {
    return this.payroll.payslips(requestPrincipal(request).userId);
  }

  @Get(':lineId')
  @ApiParam({ name: 'lineId', type: String })
  @ApiOperation({ summary: 'Read only the authenticated employee own payslip' })
  @ApiResponse({ status: 200, schema: payslipOpenApi })
  async payslip(
    @Req() request: AuthenticatedRequest,
    @Param('lineId') lineId: string,
  ) {
    try {
      return await this.payroll.payslip(
        requestPrincipal(request).userId,
        uuid.parse(lineId),
      );
    } catch (error) {
      if (error instanceof z.ZodError) throw new BadRequestException();
      if (error instanceof PayrollError && error.code === 'PAYROLL_NOT_FOUND') {
        throw new NotFoundException();
      }
      throw error;
    }
  }
}
