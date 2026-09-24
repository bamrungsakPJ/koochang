import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { APP_CONFIG, AppConfig } from './config/config';

/** Shared by main.ts and the integration tests so both run the same HTTP pipeline. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<AppConfig>(APP_CONFIG);
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', true);
}
