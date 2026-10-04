import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './shared/api-exception.filter.js';
import { productionProblems } from './config-check.js';
import { RuntimeSettingsService } from './platform/runtime-settings.service.js';
async function main() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // Image uploads arrive as raw bytes; JSON stays the default for everything else.
  app.useBodyParser('raw', { type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], limit: process.env.MAX_UPLOAD_BYTES ?? '12mb' });
  app.setGlobalPrefix('v1');
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
  const production = process.env.NODE_ENV === 'production';
  // API responses are private data: no caching, no framing, no MIME sniffing, no referrer.
  app.use((_request: unknown, response: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    if (production) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.use((request: { requestId?: string }, response: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    request.requestId = randomUUID(); response.setHeader('X-Request-Id', request.requestId); next();
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({ origin: (process.env.ADMIN_ORIGIN ?? 'http://localhost:3000').split(',').map(o => o.trim()), credentials: false });
  app.enableShutdownHooks();
  let saved;
  if(production){try{saved=await app.get(RuntimeSettingsService).read();}catch{console.warn('Console settings unavailable; runtime features remain closed until database recovers.');}}
  for (const problem of productionProblems(process.env,saved)) console.warn('CONFIG_MISSING', problem);
  await app.listen(Number(process.env.PORT ?? 4000), process.env.HOST ?? '127.0.0.1');
}
void main().catch(() => { console.error('API_START_FAILED'); process.exitCode = 1; });
