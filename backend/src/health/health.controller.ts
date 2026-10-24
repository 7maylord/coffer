import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness; independent of dependencies' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      required: ['status'],
      properties: { status: { type: 'string', enum: ['ok'] } },
    },
  })
  live() {
    return { status: 'ok' } as const;
  }

  @Get('ready')
  @ApiOperation({
    summary: 'PostgreSQL and Redis readiness; 503 on timeout or outage',
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      required: ['status'],
      properties: { status: { type: 'string', enum: ['ready'] } },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'A required dependency is unavailable',
  })
  async ready() {
    if (!(await this.health.ready())) throw new ServiceUnavailableException();
    return { status: 'ready' } as const;
  }
}
