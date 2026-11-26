import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { observeApiResponses } from './api-metrics';
import { AppModule } from './app.module';

export const CORS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

export function parseCorsOrigins(rawOrigin: string | undefined) {
  const origins = (rawOrigin ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.includes('*')) {
    throw new Error('CORS_ORIGIN must not use wildcard origins.');
  }

  return origins;
}

export function configureHttp(app: INestApplication) {
  const configService = app.get(ConfigService);
  const corsOrigins = parseCorsOrigins(configService.get<string>('CORS_ORIGIN'));

  if (configService.get<string>('API_METRICS_ENABLED') === 'true') observeApiResponses(app);
  app.enableCors({
    origin: corsOrigins,
    methods: CORS_METHODS,
    allowedHeaders: [
      'Accept',
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'X-Request-Id',
    ],
    credentials: true,
  });
}

export async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureHttp(app);
  const port = Number(app.get(ConfigService).get<string>('APP_PORT') ?? 3001);
  await app.listen(port);
}

if (require.main === module) {
  void bootstrap();
}
