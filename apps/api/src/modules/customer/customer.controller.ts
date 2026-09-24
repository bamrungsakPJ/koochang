import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { createCustomerSchema, createSiteSchema, Role, updateCustomerSchema } from '@serviceflow/shared';
import { z } from 'zod';
import { Roles, TenantAuth, TenantAuthContext } from '../../common/auth/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { CustomerService } from './customer.service';

const ALL_ROLES = [Role.OWNER, Role.ADMIN, Role.DISPATCHER, Role.TECHNICIAN];
const OFFICE_ROLES = [Role.OWNER, Role.ADMIN, Role.DISPATCHER];

/** Technicians can quick-add customers and sites on site (req §8). */
@Controller('customers')
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Roles(...ALL_ROLES)
  @Get()
  search(@TenantAuth() auth: TenantAuthContext, @Query('q') q?: string, @Query('limit') limit?: string) {
    return this.customers.search(auth, q, limit ? Number(limit) || 20 : 20);
  }

  @Roles(...ALL_ROLES)
  @Post()
  create(
    @TenantAuth() auth: TenantAuthContext,
    @Body(new ZodPipe(createCustomerSchema)) body: z.output<typeof createCustomerSchema>,
  ) {
    return this.customers.create(auth, body);
  }

  @Roles(...ALL_ROLES)
  @Get(':id')
  detail(@TenantAuth() auth: TenantAuthContext, @Param('id') id: string) {
    return this.customers.detail(auth, id);
  }

  @Roles(...OFFICE_ROLES)
  @Patch(':id')
  update(
    @TenantAuth() auth: TenantAuthContext,
    @Param('id') id: string,
    @Body(new ZodPipe(updateCustomerSchema)) body: z.output<typeof updateCustomerSchema>,
  ) {
    return this.customers.update(auth, id, body);
  }

  @Roles(...ALL_ROLES)
  @Post(':id/sites')
  addSite(
    @TenantAuth() auth: TenantAuthContext,
    @Param('id') id: string,
    @Body(new ZodPipe(createSiteSchema)) body: z.output<typeof createSiteSchema>,
  ) {
    return this.customers.addSite(auth, id, body);
  }
}
