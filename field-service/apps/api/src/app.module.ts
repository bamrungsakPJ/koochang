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
import { FilesController, MediaController } from './media/media.controller.js';
import { DevicesController, NotificationsController } from './notifications/notifications.controller.js';
import { EquipmentController } from './equipment/equipment.controller.js';
import { JobsController } from './jobs/jobs.controller.js';
import { ServiceController } from './service/service.controller.js';
import { MaintenanceController } from './maintenance/maintenance.controller.js';
import { TaxDocumentFileController, TaxDocumentsController } from './billing/tax-documents.controller.js';
import { BillingController } from './billing/billing.controller.js';
import { SlipVerificationService } from './billing/slip-verification.service.js';
import { StripeService } from './billing/stripe.service.js';
import { StripeWebhookController } from './billing/stripe-webhook.controller.js';
import { PaymentSettingsController } from './platform/payment-settings.controller.js';
import { ConsoleSettingsController } from './platform/console-settings.controller.js';
import { AccountSettingsController } from './platform/account-settings.controller.js';
import { ManagementController, StaffEnrollmentController } from './platform/management.controller.js';
import { OperationsController } from './platform/operations.controller.js';
import { PrivacyController, ExportDownloadController } from './platform/privacy.controller.js';
import { RuntimeSettingsService, RuntimeSmsSender } from './platform/runtime-settings.service.js';
import { PlatformDatabaseService } from './platform/platform-database.service.js';
import { PlatformGuard } from './platform/platform.guard.js';
import { PlatformAuthController } from './platform/platform-auth.controller.js';
import { PlatformBillingController } from './platform/platform-billing.controller.js';
import { PlatformAdminController } from './platform/platform-admin.controller.js';
import { BrandingController, BrandingSettingsController } from './platform/branding.controller.js';
import { PublicCatalogController } from './platform/public-catalog.controller.js';
import { SupportController } from './support/support.controller.js';
import { AUTH_SETTINGS, loadAuthSettings, loadMediaSettings, loadPlatformSettings, MEDIA_SETTINGS, PLATFORM_SETTINGS } from './config.js';
import { SMS_SENDER } from './sms/sms.sender.js';
import { createStorage, OBJECT_STORAGE } from './media/object-storage.js';
import { RuntimeOcrProvider, OCR_PROVIDER } from './ocr/ocr.provider.js';
@Module({
  controllers: [HealthController, AuthController, MeController, OrganizationsController, JoinController, CustomersController,
    MediaController, FilesController, NotificationsController, DevicesController, EquipmentController, JobsController, ServiceController, MaintenanceController,
    BillingController, TaxDocumentsController, TaxDocumentFileController, PlatformAuthController, PlatformBillingController, PlatformAdminController, SupportController, StripeWebhookController, PaymentSettingsController, ConsoleSettingsController, AccountSettingsController, ManagementController, StaffEnrollmentController, OperationsController, PrivacyController, ExportDownloadController, BrandingController, BrandingSettingsController, PublicCatalogController],
  providers: [
    DatabaseService, SessionGuard, TenantGuard, AuthService, JoinLinksService, PlatformDatabaseService, PlatformGuard, SlipVerificationService, StripeService, RuntimeSettingsService,
    { provide: PLATFORM_SETTINGS, useFactory: () => loadPlatformSettings() },
    { provide: AUTH_SETTINGS, useFactory: () => loadAuthSettings() },
    { provide: SMS_SENDER, useFactory: (runtime:RuntimeSettingsService) => new RuntimeSmsSender(runtime), inject:[RuntimeSettingsService] },
    { provide: MEDIA_SETTINGS, useFactory: () => loadMediaSettings() },
    { provide: OBJECT_STORAGE, useFactory: (settings: ReturnType<typeof loadMediaSettings>) => createStorage(settings.mediaDir), inject: [MEDIA_SETTINGS] },
    { provide: OCR_PROVIDER, useFactory: (runtime:RuntimeSettingsService, settings:ReturnType<typeof loadPlatformSettings>) => new RuntimeOcrProvider(() => runtime.ocrSettings(), settings.secretKey), inject:[RuntimeSettingsService, PLATFORM_SETTINGS] },
  ],
})
export class AppModule {}
