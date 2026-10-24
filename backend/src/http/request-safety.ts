import { randomUUID } from 'node:crypto';
import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { safeLogger } from './safe-logger.js';

type CorrelatedRequest = Request & { cofferCorrelationId?: string };

export function correlationId(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  // Generate locally so untrusted headers cannot forge another request's identity.
  response.locals.correlationId = randomUUID();
  (request as CorrelatedRequest).cofferCorrelationId = response.locals
    .correlationId as string;
  response.setHeader(
    'X-Correlation-ID',
    response.locals.correlationId as string,
  );
  const started = performance.now();
  response.once('finish', () => {
    const method = request.method;
    safeLogger.write({
      event: 'http_request',
      correlationId: response.locals.correlationId as string,
      method:
        method === 'GET' ||
        method === 'POST' ||
        method === 'PUT' ||
        method === 'PATCH' ||
        method === 'DELETE' ||
        method === 'HEAD' ||
        method === 'OPTIONS'
          ? method
          : 'OTHER',
      status: response.statusCode,
      durationMs: Math.max(0, Math.round(performance.now() - started)),
    });
  });
  next();
}

export function requestCorrelationId(request: Request): string {
  return (request as CorrelatedRequest).cofferCorrelationId ?? randomUUID();
}

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    // Exception text and validation details may contain credentials or payroll data.
    response.status(status).json({
      error: {
        code: `HTTP_${status}`,
        message:
          status >= 500
            ? 'Internal server error'
            : 'Request could not be completed',
        correlationId: response.locals.correlationId as string,
      },
    });
  }
}
