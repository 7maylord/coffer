import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getStatus() {
    return {
      name: 'coffer-api',
      status: 'ok',
      settlementMode: 'mock',
      liveTransfersEnabled: false,
    } as const;
  }
}
