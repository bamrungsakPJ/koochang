import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './shared/api-exception.filter.js';
async function main() {
  const app = await NestFactory.create(AppModule);
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
