import type { LoggerService } from '@nestjs/common';
import { z } from 'zod';

const eventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('http_request'),
    correlationId: z.uuid(),
    method: z.enum([
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'HEAD',
      'OPTIONS',
      'OTHER',
    ]),
    status: z.number().int().min(100).max(599),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    event: z.enum(['startup_failed', 'application_ready', 'framework_message']),
    level: z.enum(['info', 'warn', 'error', 'debug']),
  }),
]);
type SafeEvent = z.infer<typeof eventSchema>;

export class SafeLogger implements LoggerService {
  constructor(
    private readonly sink: (line: string) => void = (line) =>
      process.stdout.write(`${line}\n`),
  ) {}

  write(event: SafeEvent): void {
    // Allowlisted metadata only: never URLs, bodies, headers, exceptions or arbitrary text.
    const result = eventSchema.safeParse(event);
    if (result.success) this.sink(JSON.stringify(result.data));
  }

  log(..._messages: unknown[]): void {
    this.framework('info');
  }
  warn(..._messages: unknown[]): void {
    this.framework('warn');
  }
  error(..._messages: unknown[]): void {
    this.framework('error');
  }
  debug(..._messages: unknown[]): void {
    this.framework('debug');
  }
  verbose(..._messages: unknown[]): void {
    this.framework('debug');
  }
  fatal(..._messages: unknown[]): void {
    this.framework('error');
  }

  private framework(level: 'info' | 'warn' | 'error' | 'debug'): void {
    this.write({ event: 'framework_message', level });
  }
}

export const safeLogger = new SafeLogger();
