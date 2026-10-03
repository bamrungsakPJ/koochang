import { Body, Controller, Get, Headers, HttpCode, Ip, Patch, Post, UseGuards } from '@nestjs/common';
import { normalizeLanguage } from '@field-service/core';
import { DatabaseService } from '../database/database.service.js';
import { apiError, Validation } from '../shared/api-error.js';
import { AuthService } from './auth.service.js';
import { Session, SessionGuard, type SessionContext } from './session.guard.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('otp/request')
  requestOtp(@Body() body: Record<string, unknown>, @Ip() ip: string, @Headers('accept-language') language?: string) {
    return this.auth.requestOtp(body ?? {}, ip, normalizeLanguage(language));
  }

  @Post('otp/verify') @HttpCode(200)
  verifyOtp(@Body() body: Record<string, unknown>) { return this.auth.verifyOtp(body ?? {}); }

  @Post('refresh') @HttpCode(200)
  refresh(@Body() body: Record<string, unknown>) { return this.auth.refresh(body ?? {}); }

  @Post('logout') @HttpCode(204) @UseGuards(SessionGuard)
  async logout(@Session() session: SessionContext) { await this.auth.logout(session.sessionId); }
}

@Controller('me')
@UseGuards(SessionGuard)
export class MeController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  get(@Session() session: SessionContext) { return this.load(session.userId); }

  @Patch()
  async update(@Session() session: SessionContext, @Body() body: Record<string, unknown> = {}) {
    const check = new Validation();
    const displayName = check.text('display_name', body.display_name, { required: false, max: 80 });
    if (body.preferred_language !== undefined && body.preferred_language !== 'th' && body.preferred_language !== 'en') check.fail('preferred_language', 'field.required');
    check.done();
    await this.database.identity(client => client.query('SELECT 1 FROM auth.update_profile($1,$2,$3)',
      [session.userId, displayName ?? null, (body.preferred_language as string | undefined) ?? null]));
    return this.load(session.userId);
  }

  private load(userId: string) {
    return this.database.identity(async client => {
      const user = (await client.query('SELECT id, display_name, phone_e164, preferred_language, version FROM auth.user_profile($1)', [userId])).rows[0];
      if (!user) throw apiError(401, 'AUTHENTICATION_REQUIRED');
      const memberships = (await client.query(
        'SELECT member_id, organization_id, organization_name, organization_status, role, status, display_name, version FROM auth.user_memberships($1)', [userId])).rows;
      return { user, memberships };
    });
  }
}
