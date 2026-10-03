import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { apiError, uuidPattern } from '../shared/api-error.js';
import { AppRequest, SessionGuard } from './session.guard.js';

/** Verified session + active membership of the shop in the :organizationId route parameter.
 * The membership is read again on every request, so suspend/remove applies immediately.
 * Data access still goes through DatabaseService.withTenant, where RLS checks it once more. */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly sessions: SessionGuard, private readonly database: DatabaseService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const session = request.session = await this.sessions.resolve(request);
    const organizationId = request.params.organizationId ?? '';
    if (!uuidPattern.test(organizationId)) throw apiError(403, 'TENANT_ACCESS_DENIED');
    const membership = await this.database.identity(async client => (await client.query(
      'SELECT member_id, role, status, organization_status FROM auth.user_memberships($1) WHERE organization_id = $2',
      [session.userId, organizationId])).rows[0]);
    if (!membership || membership.organization_status !== 'active') throw apiError(403, 'TENANT_ACCESS_DENIED');
    if (membership.status !== 'active') throw apiError(403, 'MEMBERSHIP_INACTIVE');
    request.tenant = { organizationId, memberId: membership.member_id, role: membership.role };
    return true;
  }
}
