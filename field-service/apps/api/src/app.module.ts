import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { DatabaseService } from './database/database.service.js';
import { SessionGuard } from './auth/session.guard.js';
import { TenantGuard } from './auth/tenant.guard.js';
import { AuthController, MeController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { CustomersController } from './customers/customers.controller.js';
import { JoinController, OrganizationsController } from './organizations/organizations.controller.js';
import { JoinLinksService } from './organizations/join-links.service.js';
import { AUTH_SETTINGS, loadAuthSettings } from './config.js';
import { SMS_SENDER, createSmsSender } from './sms/sms.sender.js';
@Module({
  controllers: [HealthController, AuthController, MeController, OrganizationsController, JoinController, CustomersController],
  providers: [
    DatabaseService, SessionGuard, TenantGuard, AuthService, JoinLinksService,
    { provide: AUTH_SETTINGS, useFactory: () => loadAuthSettings() },
    { provide: SMS_SENDER, useFactory: () => createSmsSender() },
  ],
})
export class AppModule {}
