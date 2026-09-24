import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  assignJobSchema,
  cancelJobSchema,
  completeJobSchema,
  createJobSchema,
  needPartSchema,
  needReturnSchema,
  Role,
} from '@serviceflow/shared';
import { z } from 'zod';
import { Roles, TenantAuth, TenantAuthContext } from '../../common/auth/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { JobService } from './job.service';

const ALL_ROLES = [Role.OWNER, Role.ADMIN, Role.DISPATCHER, Role.TECHNICIAN];

/** Role/assignee checks for commands live in the state machine (job-state.ts). */
@Roles(...ALL_ROLES)
@Controller('jobs')
export class JobController {
  constructor(private readonly jobs: JobService) {}

  @Get()
  list(@TenantAuth() auth: TenantAuthContext, @Query('status') status?: string, @Query('assignee') assignee?: string) {
    return this.jobs.list(auth, { status, assignee });
  }

  @Post()
  create(@TenantAuth() auth: TenantAuthContext, @Body(new ZodPipe(createJobSchema)) body: z.output<typeof createJobSchema>) {
    return this.jobs.create(auth, body);
  }

  @Get(':id')
  detail(@TenantAuth() auth: TenantAuthContext, @Param('id') id: string) {
    return this.jobs.detail(auth, id);
  }

  @Post(':id/assign')
  @HttpCode(200)
  assign(
    @TenantAuth() auth: TenantAuthContext,
    @Param('id') id: string,
    @Body(new ZodPipe(assignJobSchema)) body: z.output<typeof assignJobSchema>,
  ) {
    return this.jobs.run(auth, id, 'assign', { assigneeId: body.assigneeId });
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(@TenantAuth() auth: TenantAuthContext, @Param('id') id: string) {
    return this.jobs.run(auth, id, 'accept');
  }

  @Post(':id/on-the-way')
  @HttpCode(200)
  onTheWay(@TenantAuth() auth: TenantAuthContext, @Param('id') id: string) {
    return this.jobs.run(auth, id, 'on-the-way');
  }

  @Post(':id/arrive')
  @HttpCode(200)
  arrive(@TenantAuth() auth: TenantAuthContext, @Param('id') id: string) {
    return this.jobs.run(auth, id, 'arrive');
  }

  @Post(':id/start')
  @HttpCode(200)
  start(@TenantAuth() auth: TenantAuthContext, @Param('id') id: string) {
    return this.jobs.run(auth, id, 'start');
  }

  @Post(':id/need-part')
  @HttpCode(200)
  needPart(
    @TenantAuth() auth: TenantAuthContext,
    @Param('id') id: string,
    @Body(new ZodPipe(needPartSchema)) body: z.output<typeof needPartSchema>,
  ) {
    return this.jobs.run(auth, id, 'need-part', { needPart: body });
  }

  @Post(':id/need-return')
  @HttpCode(200)
  needReturn(
    @TenantAuth() auth: TenantAuthContext,
    @Param('id') id: string,
    @Body(new ZodPipe(needReturnSchema)) body: z.output<typeof needReturnSchema>,
  ) {
    return this.jobs.run(auth, id, 'need-return', { returnNote: body.note });
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @TenantAuth() auth: TenantAuthContext,
    @Param('id') id: string,
    @Body(new ZodPipe(completeJobSchema)) body: z.output<typeof completeJobSchema>,
  ) {
    return this.jobs.run(auth, id, 'complete', { complete: body });
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @TenantAuth() auth: TenantAuthContext,
    @Param('id') id: string,
    @Body(new ZodPipe(cancelJobSchema)) body: z.output<typeof cancelJobSchema>,
  ) {
    return this.jobs.run(auth, id, 'cancel', { cancelReason: body.reason });
  }
}
