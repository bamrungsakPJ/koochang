import { Controller, Get, UseGuards, NotImplementedException } from '@nestjs/common';
import { TenantGuard } from '../auth/tenant.guard.js';
@Controller('organizations/:organizationId/customers')
@UseGuards(TenantGuard)
export class CustomersController {
  @Get() list(): never { throw new NotImplementedException(); }
}
