import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { foundationVersion, languages } from '@field-service/core';
import { DatabaseService } from '../database/database.service.js';
@Controller()
export class HealthController {
  constructor(private readonly database: DatabaseService) {}
  @Get('health') health() { return { status: 'ok', version: foundationVersion }; }
  @Get('capabilities') capabilities() { return { languages, authentication: 'phone_otp', businessApi: ['identity', 'customers', 'equipment', 'jobs', 'service', 'maintenance', 'billing', 'support'] }; }
  @Get('ready') async ready() {
    if (!await this.database.isReady()) throw new ServiceUnavailableException({ code: 'DATABASE_UNAVAILABLE' });
    return { status: 'ready' };
  }
}
