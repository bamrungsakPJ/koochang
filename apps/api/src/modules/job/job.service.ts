import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  completeJobSchema,
  createJobSchema,
  JobSource,
  JobStatus,
  needPartSchema,
  OPEN_JOB_STATUSES,
  Role,
} from '@serviceflow/shared';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { TenantAuthContext } from '../../common/auth/auth-context';
import { appendEvent, EventType } from '../../common/events';
import { newPublicId } from '../../common/ids';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { TenantDb } from '../../common/prisma/tenant-scope';
import { parseJson } from '../asset/asset.service';
import { assetLabel, phoneOut, siteOut } from '../customer/customer.service';
import { MediaService } from '../media/media.service';
import { allowedCommands, commandBlocker, JOB_COMMANDS, JobCommand } from './job-state';

type TenantTx = Parameters<Parameters<TenantDb['$transaction']>[0]>[0];

export interface JobOutcome {
  workTypes: string[];
  note?: string;
}

interface CommandPayload {
  assigneeId?: string;
  needPart?: z.output<typeof needPartSchema>;
  returnNote?: string;
  complete?: z.output<typeof completeJobSchema>;
  cancelReason?: string;
}

const listInclude = {
  customer: true,
  site: true,
  asset: { include: { category: true } },
  assignee: { include: { account: { select: { displayName: true } } } },
} satisfies Prisma.JobInclude;

type JobWithRefs = Prisma.JobGetPayload<{ include: typeof listInclude }>;

@Injectable()
export class JobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  /** When an asset is known, customer and site come from it (req §12). */
  async create(auth: TenantAuthContext, input: z.output<typeof createJobSchema>) {
    const tenantId = auth.membership.tenantId;
    const isTech = auth.membership.role === Role.TECHNICIAN;
    const db = this.prisma.forTenant(tenantId);

    const job = await db.$transaction(async (tx) => {
      let assetId: number | null = null;
      let customerId: number;
      let siteId: number | null = null;

      if (input.assetId) {
        const asset = await tx.asset.findFirst({ where: { publicId: input.assetId, deletedAt: null } });
        if (!asset) throw new NotFoundException('ไม่พบเครื่อง');
        assetId = asset.id;
        customerId = asset.customerId;
        siteId = asset.siteId;
      } else {
        const customer = await tx.customer.findFirst({ where: { publicId: input.customerId!, deletedAt: null } });
        if (!customer) throw new NotFoundException('ไม่พบลูกค้า');
        customerId = customer.id;
      }
      if (input.siteId) {
        const site = await tx.site.findFirst({ where: { publicId: input.siteId, customerId, deletedAt: null } });
        if (!site) throw new BadRequestException('สถานที่ไม่ใช่ของลูกค้ารายนี้');
        siteId = site.id;
      }

      // A technician logging work they found on site takes the job themselves.
      const assignee = input.assigneeId
        ? await this.findAssignee(tx, input.assigneeId)
        : isTech
          ? { id: auth.membership.id, name: auth.displayName }
          : null;

      const { jobSeq } = await tx.tenant.update({ where: { id: tenantId }, data: { jobSeq: { increment: 1 } } });
      const now = new Date();
      const created = await tx.job.create({
        data: {
          publicId: newPublicId(),
          tenantId,
          jobNo: `J-${String(jobSeq).padStart(6, '0')}`,
          assetId,
          customerId,
          siteId,
          source: isTech ? JobSource.TECH : JobSource.ADMIN,
          issueType: input.issueType,
          issueNote: input.issueNote,
          scheduledFor: input.scheduledFor,
          status: assignee ? JobStatus.ASSIGNED : JobStatus.NEW,
          assignedMembershipId: assignee?.id ?? null,
          assignedAt: assignee ? now : null,
        },
      });

      const base = { tenantId, actorType: 'ACCOUNT' as const, actorId: auth.accountPublicId, subjectType: 'JOB', subjectId: created.publicId, jobId: created.id, assetId, customerId };
      await appendEvent(tx, {
        ...base,
        eventType: EventType.JOB_CREATED,
        metadata: { actorName: auth.displayName, jobNo: created.jobNo, issueType: created.issueType, source: created.source },
      });
      if (assignee) {
        await appendEvent(tx, {
          ...base,
          eventType: EventType.TECHNICIAN_ASSIGNED,
          metadata: { actorName: auth.displayName, assigneeName: assignee.name },
        });
      }
      return created;
    });
    return this.detail(auth, job.publicId);
  }

  async list(auth: TenantAuthContext, filter: { status?: string; assignee?: string }) {
    const db = this.prisma.forTenant(auth.membership.tenantId);
    const where: Prisma.JobWhereInput = {};

    if (filter.status === 'open') where.status = { in: OPEN_JOB_STATUSES };
    else if (filter.status === 'closed') where.status = { in: [JobStatus.COMPLETED, JobStatus.CANCELLED] };
    else if (filter.status && filter.status !== 'all') where.status = filter.status;

    // Technicians only ever see their own jobs.
    if (auth.membership.role === Role.TECHNICIAN || filter.assignee === 'me') {
      where.assignedMembershipId = auth.membership.id;
    } else if (filter.assignee === 'none') {
      where.assignedMembershipId = null;
    } else if (filter.assignee) {
      where.assignee = { publicId: filter.assignee };
    }

    const rows = await db.job.findMany({
      where,
      include: listInclude,
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    });
    return rows.map((j) => this.summary(j));
  }

  async detail(auth: TenantAuthContext, publicId: string) {
    const db = this.prisma.forTenant(auth.membership.tenantId);
    const j = await db.job.findFirst({
      where: { publicId },
      include: {
        ...listInclude,
        asset: { include: { category: true, primaryMedia: true } },
        partsUsed: { orderBy: { id: 'asc' } },
        partRequests: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!j || !this.canSee(auth, j.assignedMembershipId)) throw new NotFoundException('ไม่พบงาน');

    const [photos, events, history] = await Promise.all([
      db.media.findMany({ where: { ownerType: 'JOB', ownerId: j.id, deletedAt: null }, orderBy: { createdAt: 'asc' } }),
      db.domainEvent.findMany({ where: { jobId: j.id }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] }),
      j.assetId
        ? db.job.findMany({
            where: { assetId: j.assetId, status: JobStatus.COMPLETED, id: { not: j.id } },
            orderBy: { completedAt: 'desc' },
            take: 5,
            include: { partsUsed: true },
          })
        : Promise.resolve([]),
    ]);

    const isAssignee = j.assignedMembershipId === auth.membership.id;
    return {
      ...this.summary(j),
      issueNote: j.issueNote,
      returnNote: j.returnNote,
      source: j.source,
      timestamps: {
        assignedAt: j.assignedAt,
        acceptedAt: j.acceptedAt,
        onTheWayAt: j.onTheWayAt,
        arrivedAt: j.arrivedAt,
        startedAt: j.startedAt,
        completedAt: j.completedAt,
        cancelledAt: j.cancelledAt,
      },
      customer: { id: j.customer.publicId, displayName: j.customer.displayName, phone: phoneOut(j.customer.phoneE164) },
      site: j.site ? siteOut(j.site) : null,
      asset: j.asset
        ? {
            id: j.asset.publicId,
            label: assetLabel(j.asset),
            category: j.asset.category?.name ?? null,
            issueTypes: parseJson<string[]>(j.asset.category?.issueTypesJson, []),
            brand: j.asset.brand,
            model: j.asset.model,
            serialNumber: j.asset.serialNumber,
            installedAt: j.asset.installedAt,
            warrantyEnd: j.asset.warrantyEnd,
            photoUrl: j.asset.primaryMedia && !j.asset.primaryMedia.deletedAt ? this.media.signedUrl(j.asset.primaryMedia.publicId) : null,
          }
        : null,
      outcome: parseJson<JobOutcome | null>(j.outcomeJson, null),
      partsUsed: j.partsUsed.map((p) => ({ name: p.name, spec: p.spec, qty: p.qty })),
      partRequests: j.partRequests.map((p) => ({
        id: p.publicId,
        description: p.description,
        status: p.status,
        createdAt: p.createdAt,
      })),
      photos: photos.map((m) => ({ id: m.publicId, kind: m.kind, url: this.media.signedUrl(m.publicId) })),
      previousService: history.map((h) => ({
        id: h.publicId,
        jobNo: h.jobNo,
        completedAt: h.completedAt,
        workTypes: parseJson<JobOutcome | null>(h.outcomeJson, null)?.workTypes ?? [],
        parts: h.partsUsed.map((p) => [p.name, p.spec, p.qty > 1 ? `x${p.qty}` : null].filter(Boolean).join(' ')),
      })),
      events: events.map((e) => {
        const { actorName, ...details } = parseJson<Record<string, unknown>>(e.metadataJson, {});
        return { type: e.eventType, occurredAt: e.occurredAt, actorName: (actorName as string) ?? null, details };
      }),
      allowedActions: allowedCommands({ status: j.status, role: auth.membership.role, isAssignee }),
    };
  }

  async run(auth: TenantAuthContext, publicId: string, cmd: JobCommand, payload: CommandPayload = {}) {
    const tenantId = auth.membership.tenantId;
    const db = this.prisma.forTenant(tenantId);
    const rule = JOB_COMMANDS[cmd];

    await db.$transaction(async (tx) => {
      const job = await tx.job.findFirst({ where: { publicId } });
      if (!job || !this.canSee(auth, job.assignedMembershipId)) throw new NotFoundException('ไม่พบงาน');

      const blocker = commandBlocker(cmd, {
        status: job.status,
        role: auth.membership.role,
        isAssignee: job.assignedMembershipId === auth.membership.id,
      });
      if (blocker === 'role') throw new ForbiddenException('ไม่มีสิทธิ์ทำรายการนี้');
      if (blocker === 'status') throw new ConflictException('สถานะงานเปลี่ยนไปแล้ว กรุณารีเฟรช');

      const now = new Date();
      const data: Prisma.JobUncheckedUpdateManyInput = { status: rule.to };
      if (rule.stamp) data[rule.stamp] = now;
      const metadata: Record<string, unknown> = { actorName: auth.displayName, from: job.status };

      if (cmd === 'assign') {
        const assignee = await this.findAssignee(tx, payload.assigneeId!);
        data.assignedMembershipId = assignee.id;
        // A new visit starts from scratch; earlier visit times stay in the event log.
        Object.assign(data, { acceptedAt: null, onTheWayAt: null, arrivedAt: null, startedAt: null });
        metadata.assigneeName = assignee.name;
        await tx.partRequest.updateMany({
          where: { jobId: job.id, status: 'REQUESTED' },
          data: { status: 'RESOLVED', resolvedAt: now },
        });
      }
      if (cmd === 'need-return') {
        data.returnNote = payload.returnNote ?? null;
        metadata.note = payload.returnNote;
      }
      if (cmd === 'cancel') metadata.reason = payload.cancelReason;

      // Optimistic check: only move if nobody else changed the status meanwhile.
      const moved = await tx.job.updateMany({ where: { id: job.id, status: job.status }, data });
      if (moved.count !== 1) throw new ConflictException('สถานะงานเปลี่ยนไปแล้ว กรุณารีเฟรช');

      if (cmd === 'need-part') {
        const input = payload.needPart!;
        const mediaId = input.mediaId ? (await this.media.attach(tx, [input.mediaId], 'JOB', job.id))[0] : null;
        await tx.partRequest.create({
          data: {
            publicId: newPublicId(),
            tenantId,
            jobId: job.id,
            description: input.description,
            mediaId,
            requestedByMembershipId: auth.membership.id,
          },
        });
        metadata.part = input.description ?? 'ดูรูป';
      }
      if (cmd === 'complete') await this.recordCompletion(tx, auth, job.id, payload.complete!, metadata);

      await appendEvent(tx, {
        tenantId,
        eventType: rule.event,
        actorType: 'ACCOUNT',
        actorId: auth.accountPublicId,
        subjectType: 'JOB',
        subjectId: job.publicId,
        jobId: job.id,
        assetId: job.assetId,
        customerId: job.customerId,
        metadata: { ...metadata, jobNo: job.jobNo },
      });
    });
    return this.detail(auth, publicId);
  }

  private async recordCompletion(
    tx: TenantTx,
    auth: TenantAuthContext,
    jobId: number,
    input: z.output<typeof completeJobSchema>,
    metadata: Record<string, unknown>,
  ) {
    const outcome: JobOutcome = { workTypes: input.workTypes, note: input.note };
    await tx.job.update({ where: { id: jobId }, data: { outcomeJson: JSON.stringify(outcome) } });
    if (input.parts.length) {
      await tx.partUsed.createMany({
        data: input.parts.map((p) => ({ tenantId: auth.membership.tenantId, jobId, name: p.name, spec: p.spec, qty: p.qty })),
      });
    }
    await this.media.attach(tx, input.mediaIds, 'JOB', jobId);
    await tx.partRequest.updateMany({
      where: { jobId, status: 'REQUESTED' },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    // Enough to render service history without joins (req §18 example: "Replaced Capacitor 35uF").
    Object.assign(metadata, {
      workTypes: input.workTypes,
      parts: input.parts.map((p) => [p.name, p.spec, p.qty > 1 ? `x${p.qty}` : null].filter(Boolean).join(' ')),
      note: input.note,
      photoCount: input.mediaIds.length,
    });
  }

  private async findAssignee(tx: TenantTx, membershipPublicId: string) {
    const m = await tx.membership.findFirst({
      where: { publicId: membershipPublicId, status: 'ACTIVE' },
      include: { account: { select: { displayName: true } } },
    });
    if (!m) throw new BadRequestException('ไม่พบช่างในร้านนี้');
    return { id: m.id, name: m.account.displayName };
  }

  private canSee(auth: TenantAuthContext, assignedMembershipId: number | null): boolean {
    return auth.membership.role !== Role.TECHNICIAN || assignedMembershipId === auth.membership.id;
  }

  private summary(j: JobWithRefs) {
    return {
      id: j.publicId,
      jobNo: j.jobNo,
      status: j.status,
      issueType: j.issueType,
      createdAt: j.createdAt,
      scheduledFor: j.scheduledFor,
      customerName: j.customer.displayName,
      siteName: j.site?.displayName ?? null,
      assetLabel: j.asset ? assetLabel(j.asset) : null,
      assignee: j.assignee ? { id: j.assignee.publicId, displayName: j.assignee.account.displayName } : null,
    };
  }
}
