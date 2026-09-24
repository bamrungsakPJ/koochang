import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { createAssetSchema, Role, updateAssetSchema } from '@serviceflow/shared';
import { z } from 'zod';
import { Roles, TenantAuth, TenantAuthContext } from '../../common/auth/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { AssetService } from './asset.service';

const ALL_ROLES = [Role.OWNER, Role.ADMIN, Role.DISPATCHER, Role.TECHNICIAN];

@Controller()
export class AssetController {
  constructor(private readonly assets: AssetService) {}

  @Roles(...ALL_ROLES)
  @Get('asset-categories')
  categories(@TenantAuth() auth: TenantAuthContext) {
    return this.assets.categories(auth);
  }

  @Roles(...ALL_ROLES)
  @Get('assets')
  list(@TenantAuth() auth: TenantAuthContext, @Query('q') q?: string, @Query('customerId') customerId?: string) {
    return this.assets.list(auth, q, customerId);
  }

  @Roles(...ALL_ROLES)
  @Post('assets')
  create(
    @TenantAuth() auth: TenantAuthContext,
    @Body(new ZodPipe(createAssetSchema)) body: z.output<typeof createAssetSchema>,
  ) {
    return this.assets.create(auth, body);
  }

  @Roles(...ALL_ROLES)
  @Get('assets/:id')
  detail(@TenantAuth() auth: TenantAuthContext, @Param('id') id: string) {
    return this.assets.detail(auth, id);
  }

  @Roles(...ALL_ROLES)
  @Patch('assets/:id')
  update(
    @TenantAuth() auth: TenantAuthContext,
    @Param('id') id: string,
    @Body(new ZodPipe(updateAssetSchema)) body: z.output<typeof updateAssetSchema>,
  ) {
    return this.assets.update(auth, id, body);
  }
}
