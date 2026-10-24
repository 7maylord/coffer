import { Global, Module } from '@nestjs/common';
import { APP_ENVIRONMENT, parseEnvironment } from './env.js';

@Global()
@Module({
  providers: [
    { provide: APP_ENVIRONMENT, useFactory: () => parseEnvironment() },
  ],
  exports: [APP_ENVIRONMENT],
})
export class ConfigModule {}
