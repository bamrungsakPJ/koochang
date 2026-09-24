import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConsoleSmsSender, DeeSmsxSender, SMS_SENDER } from '../adapters/sms';
import { DevLineIdTokenVerifier, LINE_ID_TOKEN_VERIFIER, LineApiIdTokenVerifier } from '../adapters/line-auth';
import { APP_CONFIG, AppConfig, loadConfig } from '../config/config';
import { AuthGuard } from './auth/auth.guard';
import { SessionCookie } from './auth/session-cookie';
import { TokenService } from './auth/token.service';
import { PrismaService } from './prisma/prisma.service';
import { RateLimiter } from './rate-limiter';

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    PrismaService,
    TokenService,
    SessionCookie,
    RateLimiter,
    {
      provide: SMS_SENDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.SMS_MODE === 'deesmsx'
          ? new DeeSmsxSender({
              baseUrl: config.DEESMSX_BASE_URL,
              apiKey: config.DEESMSX_API_KEY,
              secretKey: config.DEESMSX_SECRET_KEY,
              sender: config.DEESMSX_SENDER,
            })
          : new ConsoleSmsSender(),
    },
    {
      provide: LINE_ID_TOKEN_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.LINE_AUTH_MODE === 'line'
          ? new LineApiIdTokenVerifier(config.LINE_LOGIN_CHANNEL_ID)
          : new DevLineIdTokenVerifier(),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [APP_CONFIG, PrismaService, TokenService, SessionCookie, RateLimiter, SMS_SENDER, LINE_ID_TOKEN_VERIFIER],
})
export class CommonModule {}
