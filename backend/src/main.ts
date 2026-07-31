import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
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

export async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = Number(configService.get<string>('APP_PORT') ?? 3001);
  const corsOrigins = parseCorsOrigins(configService.get<string>('CORS_ORIGIN'));

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

  await app.listen(port);
}

if (require.main === module) {
  void bootstrap();
}
