import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { Session, SessionGuard, Tenant, type SessionContext, type TenantContext } from '../auth/session.guard.js';
import { TenantGuard } from '../auth/tenant.guard.js';
import { DatabaseService } from '../database/database.service.js';
import { uuidPattern, Validation } from '../shared/api-error.js';

/** In-app inbox. RLS (restrictive policy) limits every query to the caller's own notifications.
 * Text is rendered by the app from template + parameters in the reader's language. */
@Controller('organizations/:organizationId/notifications')
@UseGuards(TenantGuard)
export class NotificationsController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  list(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Query('limit') limit?: string) {
    const size = Math.min(Math.max(Number(limit) || 30, 1), 100);
    return this.database.withTenant(session.userId, tenant.organizationId, async client => {
      const items = (await client.query(
        `SELECT id, template_key, parameters, target_type, target_id, created_at, read_at FROM core.notifications
         WHERE organization_id = $1 AND recipient_user_id = $2 ORDER BY created_at DESC LIMIT $3`, [tenant.organizationId, session.userId, size])).rows;
      const unread = (await client.query('SELECT count(*)::int AS n FROM core.notifications WHERE organization_id = $1 AND recipient_user_id = $2 AND read_at IS NULL',
        [tenant.organizationId, session.userId])).rows[0].n as number;
      return { items, unread };
    });
  }

  /** Marks the given ids, or everything when no ids are sent, as read. */
  @Post('read') @HttpCode(200)
  async read(@Session() session: SessionContext, @Tenant() tenant: TenantContext, @Body() body: Record<string, unknown> = {}) {
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string' && uuidPattern.test(id)).slice(0, 200) : null;
    await this.database.withTenant(session.userId, tenant.organizationId, client => client.query(
      `UPDATE core.notifications SET read_at = now() WHERE organization_id = $1 AND recipient_user_id = $2 AND read_at IS NULL
       AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[]))`, [tenant.organizationId, session.userId, ids]));
    return this.list(session, tenant);
  }
}

/** Push tokens belong to the account and device, not to a shop. */
@Controller('me/devices')
@UseGuards(SessionGuard)
export class DevicesController {
  constructor(private readonly database: DatabaseService) {}

  @Post() @HttpCode(204)
  async register(@Session() session: SessionContext, @Body() body: Record<string, unknown> = {}) {
    const check = new Validation();
    const token = check.text('token', body.token, { max: 512 });
    if (!['ios', 'android', 'web'].includes(body.platform as string)) check.fail('platform', 'field.required');
    check.done();
    await this.database.identity(client => client.query('SELECT auth.register_device($1,$2,$3)', [session.userId, token, body.platform]));
  }

  @Post('remove') @HttpCode(204)
  async remove(@Session() session: SessionContext, @Body() body: Record<string, unknown> = {}) {
    if (typeof body.token === 'string') await this.database.identity(client => client.query('SELECT auth.revoke_device($1,$2)', [session.userId, body.token]));
  }
}
