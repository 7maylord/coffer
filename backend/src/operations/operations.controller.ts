import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiQuery,
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
import { requestCorrelationId } from '../http/request-safety.js';
import { PrismaOperationsStore } from './prisma-operations.store.js';
import { OperationsError } from './operations.types.js';

const uuid = z.string().uuid();
const limit = z.coerce.number().int().min(1).max(100).default(50);
const eventType = z.string().trim().min(1).max(100).optional();
const idempotencyKey = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\x21-\x7e]+$/);
const reconciliationCaseSchema: SchemaObject = {
  type: 'object',
  required: ['id', 'reasonCode', 'status', 'createdAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    reasonCode: { type: 'string' },
    status: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
  },
};
const attemptSchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'provider',
    'status',
    'version',
    'pollCount',
    'createdAt',
    'updatedAt',
    'reconciliationCase',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    provider: { type: 'string' },
    status: { type: 'string' },
    version: { type: 'integer' },
    pollCount: { type: 'integer' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    reconciliationCase: { oneOf: [reconciliationCaseSchema, { type: 'null' }] },
  },
};
const auditSchema: SchemaObject = {
  type: 'object',
  required: ['events', 'nextCursor', 'integrity'],
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'id',
          'sequence',
          'actorId',
          'eventType',
          'entityType',
          'entityId',
          'correlationId',
          'traceId',
          'previousHash',
          'eventHash',
          'metadata',
          'createdAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          sequence: { type: 'integer' },
          actorId: {
            oneOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }],
          },
          eventType: { type: 'string' },
          entityType: { type: 'string' },
          entityId: { type: 'string' },
          correlationId: { type: 'string' },
          traceId: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          previousHash: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          eventHash: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    nextCursor: {
      oneOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }],
    },
    integrity: {
      type: 'object',
      required: ['verified', 'eventCount', 'headHash', 'algorithm'],
      properties: {
        verified: { type: 'boolean' },
        eventCount: { type: 'integer' },
        headHash: { oneOf: [{ type: 'string' }, { type: 'null' }] },
        algorithm: { type: 'string', enum: ['SHA-256'] },
      },
    },
  },
};
const dashboardSchema: SchemaObject = {
  type: 'object',
  required: [
    'generatedAt',
    'stuckThresholdSeconds',
    'queued',
    'pending',
    'stuck',
    'refunded',
    'completed',
  ],
  properties: {
    generatedAt: { type: 'string', format: 'date-time' },
    stuckThresholdSeconds: { type: 'integer' },
    queued: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'id',
          'topic',
          'aggregateId',
          'attempts',
          'availableAt',
          'lastErrorCode',
          'createdAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          topic: { type: 'string' },
          aggregateId: { type: 'string' },
          attempts: { type: 'integer' },
          availableAt: { type: 'string', format: 'date-time' },
          lastErrorCode: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    pending: { type: 'array', items: attemptSchema },
    stuck: { type: 'array', items: attemptSchema },
    refunded: { type: 'array', items: attemptSchema },
    completed: { type: 'array', items: attemptSchema },
  },
};
const metricsSchema: SchemaObject = {
  type: 'object',
  required: [
    'generatedAt',
    'paymentsByStatus',
    'queuedOutboxEvents',
    'openReconciliationCases',
    'stalePendingPayments',
    'oldestQueuedAt',
  ],
  properties: {
    generatedAt: { type: 'string', format: 'date-time' },
    paymentsByStatus: {
      type: 'object',
      additionalProperties: { type: 'integer' },
    },
    queuedOutboxEvents: { type: 'integer' },
    openReconciliationCases: { type: 'integer' },
    stalePendingPayments: { type: 'integer' },
    oldestQueuedAt: {
      oneOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }],
    },
  },
};
const recheckSchema: SchemaObject = {
  type: 'object',
  required: [
    'actionId',
    'caseId',
    'paymentId',
    'action',
    'status',
    'createdAt',
  ],
  properties: {
    actionId: { type: 'string', format: 'uuid' },
    caseId: { type: 'string', format: 'uuid' },
    paymentId: { type: 'string', format: 'uuid' },
    action: { type: 'string', enum: ['RECHECK_EXISTING_PAYMENT'] },
    status: { type: 'string', enum: ['QUEUED'] },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

@ApiTags('operations')
@ApiCookieAuth('coffer_session')
@UseGuards(SessionGuard, CsrfGuard, OrganizationPermissionGuard)
@Controller('v1/orgs/:orgId')
export class OperationsController {
  constructor(
    @Inject(PrismaOperationsStore)
    private readonly operations: PrismaOperationsStore,
  ) {}

  @Get('audit')
  @RequireOrganizationPermission('audit:read')
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'eventType', required: false, type: String })
  @ApiOperation({
    summary: 'Read redacted hash-chained organization audit events',
  })
  @ApiResponse({ status: 200, schema: auditSchema })
  audit(
    @Param('orgId') organizationId: string,
    @Query('limit') rawLimit?: string,
    @Query('cursor') cursor?: string,
    @Query('eventType') rawEventType?: string,
  ) {
    return this.execute(() =>
      this.operations.audit(organizationId, {
        limit: limit.parse(rawLimit),
        cursor: cursor ? uuid.parse(cursor) : undefined,
        eventType: eventType.parse(rawEventType),
      }),
    );
  }

  @Get('operations/settlements')
  @RequireOrganizationPermission('operations:read')
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({
    summary: 'Read the tenant-scoped settlement operations dashboard',
  })
  @ApiResponse({ status: 200, schema: dashboardSchema })
  dashboard(
    @Param('orgId') organizationId: string,
    @Query('limit') rawLimit?: string,
  ) {
    return this.execute(() =>
      this.operations.dashboard(organizationId, limit.parse(rawLimit)),
    );
  }

  @Get('operations/metrics')
  @RequireOrganizationPermission('operations:read')
  @ApiOperation({ summary: 'Read aggregate settlement operations metrics' })
  @ApiResponse({ status: 200, schema: metricsSchema })
  metrics(@Param('orgId') organizationId: string) {
    return this.operations.metrics(organizationId);
  }

  @Post('operations/reconciliation/:caseId/recheck')
  @RequireOrganizationPermission('operations:reconcile')
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Queue a safe recheck of an existing uncertain payment',
  })
  @ApiResponse({ status: 201, schema: recheckSchema })
  recheck(
    @Req() request: AuthenticatedRequest,
    @Param('orgId') organizationId: string,
    @Param('caseId') caseId: string,
    @Headers('idempotency-key') rawIdempotencyKey?: string,
  ) {
    return this.execute(() =>
      this.operations.recheck({
        organizationId,
        caseId: uuid.parse(caseId),
        actorUserId: requestPrincipal(request).userId,
        idempotencyKey: idempotencyKey.parse(rawIdempotencyKey),
        correlationId: requestCorrelationId(request),
      }),
    );
  }

  private async execute<T>(operation: () => T | Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof z.ZodError) throw new BadRequestException();
      if (error instanceof OperationsError) {
        if (error.code === 'OPERATIONS_NOT_FOUND')
          throw new NotFoundException();
        if (error.code === 'IDEMPOTENCY_CONFLICT')
          throw new ConflictException();
        throw new BadRequestException();
      }
      throw error;
    }
  }
}
