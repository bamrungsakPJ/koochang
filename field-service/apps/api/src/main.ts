import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './shared/api-exception.filter.js';
async function main() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Image uploads arrive as raw bytes; JSON stays the default for everything else.
  app.useBodyParser('raw', { type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: process.env.MAX_UPLOAD_BYTES ?? '12mb' });
  app.setGlobalPrefix('v1');
  app.use((request: { requestId?: string }, response: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    request.requestId = randomUUID(); response.setHeader('X-Request-Id', request.requestId); next();
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({ origin: (process.env.ADMIN_ORIGIN ?? 'http://localhost:3000').split(',').map(o => o.trim()), credentials: false });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 4000), process.env.HOST ?? '127.0.0.1');
}
void main().catch(() => { console.error('API_START_FAILED'); process.exitCode = 1; });
