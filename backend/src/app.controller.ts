import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';

@ApiTags('system')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Report the API safety mode' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'status', 'settlementMode', 'liveTransfersEnabled'],
      properties: {
        name: { type: 'string', enum: ['coffer-api'] },
        status: { type: 'string', enum: ['ok'] },
        settlementMode: { type: 'string', enum: ['mock'] },
        liveTransfersEnabled: { type: 'boolean', enum: [false] },
      },
    },
  })
  getStatus() {
    return this.appService.getStatus();
  }
}
