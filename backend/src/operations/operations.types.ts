export type AuditEventView = {
  id: string;
  sequence: number;
  actorId: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  correlationId: string;
  traceId: string | null;
  previousHash: string | null;
  eventHash: string;
  metadata: unknown;
  createdAt: string;
};

export class OperationsError extends Error {
  constructor(
    readonly code:
      | 'OPERATIONS_NOT_FOUND'
      | 'RECONCILIATION_NOT_ACTIONABLE'
      | 'IDEMPOTENCY_REQUIRED'
      | 'IDEMPOTENCY_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'OperationsError';
  }
}
