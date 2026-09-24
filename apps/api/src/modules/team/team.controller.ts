import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { acceptInviteSchema, createInviteSchema, Role } from '@serviceflow/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { Public, Roles, TenantAuth, TenantAuthContext } from '../../common/auth/auth-context';
import { SessionCookie } from '../../common/auth/session-cookie';
import { ZodPipe } from '../../common/zod.pipe';
import { TeamService } from './team.service';

@Controller()
export class TeamController {
  constructor(
    private readonly team: TeamService,
    private readonly cookie: SessionCookie,
  ) {}

  @Roles(Role.OWNER, Role.ADMIN)
  @Post('invites')
  createInvite(
    @TenantAuth() auth: TenantAuthContext,
    @Body(new ZodPipe(createInviteSchema)) body: z.output<typeof createInviteSchema>,
  ) {
    return this.team.createInvite(auth, body.role);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Get('invites')
  listInvites(@TenantAuth() auth: TenantAuthContext) {
    return this.team.listPendingInvites(auth);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Delete('invites/:id')
  @HttpCode(204)
  revokeInvite(@TenantAuth() auth: TenantAuthContext, @Param('id') id: string) {
    return this.team.revokeInvite(auth, id);
  }

  @Roles(Role.OWNER, Role.ADMIN, Role.DISPATCHER)
  @Get('memberships')
  listMembers(@TenantAuth() auth: TenantAuthContext) {
    return this.team.listMembers(auth);
  }

  @Roles(Role.OWNER, Role.ADMIN)
  @Delete('memberships/:id')
  @HttpCode(204)
  removeMember(@TenantAuth() auth: TenantAuthContext, @Param('id') id: string) {
    return this.team.removeMember(auth, id);
  }

  @Public()
  @Get('public/invites/:token')
  previewInvite(@Param('token') token: string) {
    return this.team.previewInvite(token);
  }

  @Public()
  @Post('public/invites/:token/accept')
  async acceptInvite(
    @Param('token') token: string,
    @Body(new ZodPipe(acceptInviteSchema)) body: z.output<typeof acceptInviteSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.cookie.respond(res, await this.team.acceptInvite(token, body));
  }
}
