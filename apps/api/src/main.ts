import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { APP_CONFIG, AppConfig } from './config/config';

async function bootstrap() {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: rely on the real environment (production).
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(app.get<AppConfig>(APP_CONFIG).PORT);
}

void bootstrap();
