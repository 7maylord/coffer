import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const configuration = new DocumentBuilder()
    .setOpenAPIVersion('3.1.0')
    .setTitle('Coffer API')
    .setVersion('0.1.0')
    .setDescription(
      'Coffer local foundation with NEP-413 authentication, deterministic policy approvals, and mock settlement. Contract calls are unsigned; no endpoint signs or broadcasts funds.',
    )
    .addServer('http://localhost:4000', 'Local development')
    .addCookieAuth('coffer_session')
    .build();

  return SwaggerModule.createDocument(app, configuration, {
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}.${methodKey}`,
  });
}
