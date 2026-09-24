import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createAssetSchema, OPEN_JOB_STATUSES, updateAssetSchema } from '@serviceflow/shared';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { TenantAuthContext } from '../../common/auth/auth-context';
import { appendEvent, EventType } from '../../common/events';
import { newPublicId } from '../../common/ids';
import { PrismaService } from '../../common/prisma/prisma.service';
import { seedDefaultCategories } from '../../common/seed';
import { assetLabel, CustomerService, phoneOut, siteOut } from '../customer/customer.service';
import { MediaService } from '../media/media.service';

/** Events that make up an asset's service history (req §18); job micro-steps stay on the job. */
const ASSET_TIMELINE_EVENTS = [
  EventType.ASSET_INSTALLED,
  EventType.ASSET_UPDATED,
  EventType.JOB_CREATED,
  EventType.PART_REQUIRED,
  EventType.RETURN_VISIT_REQUIRED,
  EventType.JOB_COMPLETED,
  EventType.JOB_CANCELLED,
];

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

@Injectable()
export class AssetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomerService,
    private readonly media: MediaService,
  ) {}

  async categories(auth: TenantAuthContext) {
    const db = this.prisma.forTenant(auth.membership.tenantId);
    let rows = await db.assetCategory.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } });
    if (rows.length === 0) {
      // Shops created before categories existed get the defaults on first use.
      await seedDefaultCategories(db, auth.membership.tenantId);
      rows = await db.assetCategory.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } });
    }
    return rows.map((c) => ({ id: c.publicId, name: c.name, issueTypes: parseJson<string[]>(c.issueTypesJson, []) }));
  }

  /** Zero-form install (req §8): installed date, installer and status are recorded automatically. */
  async create(auth: TenantAuthContext, input: z.output<typeof createAssetSchema>) {
    const tenantId = auth.membership.tenantId;
    const db = this.prisma.forTenant(tenantId);

    const asset = await db.$transaction(async (tx) => {
      const customer = input.customerId
        ? await tx.customer.findFirst({ where: { publicId: input.customerId, deletedAt: null } })
        : await this.customers.createInTx(tx, auth, input.newCustomer!);
      if (!customer) throw new NotFoundException('ไม่พบลูกค้า');

      let siteId: number | null = null;
      if (input.siteId) {
        const site = await tx.site.findFirst({ where: { publicId: input.siteId, customerId: customer.id, deletedAt: null } });
        if (!site) throw new BadRequestException('สถานที่ไม่ใช่ของลูกค้ารายนี้');
        siteId = site.id;
      } else if (input.newSite) {
        siteId = (await this.customers.createSiteInTx(tx, auth, customer.id, input.newSite)).id;
      } else {
        // One site only → it's obviously that one; don't ask.
        const sites = await tx.site.findMany({ where: { customerId: customer.id, deletedAt: null }, take: 2 });
        if (sites.length === 1) siteId = sites[0].id;
      }

      let categoryId: number | null = null;
      if (input.categoryId) {
        const cat = await tx.assetCategory.findFirst({ where: { publicId: input.categoryId, deletedAt: null } });
        if (!cat) throw new BadRequestException('ไม่พบประเภทเครื่อง');
        categoryId = cat.id;
      }

      const created = await tx.asset.create({
        data: {
          publicId: newPublicId(),
          tenantId,
          customerId: customer.id,
          siteId,
          categoryId,
          brand: input.brand,
          model: input.model,
          serialNumber: input.serialNumber,
          installedAt: input.installedAt ?? new Date(),
          installedByMembershipId: auth.membership.id,
          notes: input.notes,
          fieldSourcesJson: JSON.stringify(
            Object.fromEntries(
              (['brand', 'model', 'serialNumber'] as const).filter((k) => input[k]).map((k) => [k, 'MANUAL']),
            ),
          ),
        },
      });

      if (input.primaryMediaId) {
        const [mediaId] = await this.media.attach(tx, [input.primaryMediaId], 'ASSET', created.id);
        await tx.asset.update({ where: { id: created.id }, data: { primaryMediaId: mediaId } });
      }

      await appendEvent(tx, {
        tenantId,
        eventType: EventType.ASSET_INSTALLED,
        actorType: 'ACCOUNT',
        actorId: auth.accountPublicId,
        subjectType: 'ASSET',
        subjectId: created.publicId,
        assetId: created.id,
        customerId: customer.id,
        metadata: { actorName: auth.displayName, brand: created.brand, model: created.model },
      });
      return created;
    });
    return this.detail(auth, asset.publicId);
  }

  async list(auth: TenantAuthContext, q: string | undefined, customerId: string | undefined) {
    const db = this.prisma.forTenant(auth.membership.tenantId);
    const where: Prisma.AssetWhereInput = { deletedAt: null };
    if (customerId) where.customer = { publicId: customerId };
    const term = q?.trim();
    if (term) {
      where.OR = [
        { serialNumber: { contains: term } },
        { model: { contains: term } },
        { brand: { contains: term } },
        { customer: { displayName: { contains: term } } },
      ];
    }
    const rows = await db.asset.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { category: true, customer: true, site: true },
    });
    return rows.map((a) => ({
      id: a.publicId,
      label: assetLabel(a),
      category: a.category?.name ?? null,
      serialNumber: a.serialNumber,
      customer: { id: a.customer.publicId, displayName: a.customer.displayName },
      siteName: a.site?.displayName ?? null,
    }));
  }

  async detail(auth: TenantAuthContext, publicId: string) {
    const db = this.prisma.forTenant(auth.membership.tenantId);
    const a = await db.asset.findFirst({
      where: { publicId, deletedAt: null },
      include: {
        category: true,
        customer: true,
        site: true,
        installedBy: { include: { account: { select: { displayName: true } } } },
        primaryMedia: true,
        jobs: {
          where: { status: { in: OPEN_JOB_STATUSES } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!a) throw new NotFoundException('ไม่พบเครื่อง');

    return {
      id: a.publicId,
      label: assetLabel(a),
      category: a.category
        ? { id: a.category.publicId, name: a.category.name, issueTypes: parseJson<string[]>(a.category.issueTypesJson, []) }
        : null,
      brand: a.brand,
      model: a.model,
      serialNumber: a.serialNumber,
      status: a.status,
      notes: a.notes,
      installedAt: a.installedAt,
      installedBy: a.installedBy?.account.displayName ?? null,
      warrantyEnd: a.warrantyEnd,
      nextServiceDate: a.nextServiceDate,
      photoUrl: a.primaryMedia && !a.primaryMedia.deletedAt ? this.media.signedUrl(a.primaryMedia.publicId) : null,
      customer: { id: a.customer.publicId, displayName: a.customer.displayName, phone: phoneOut(a.customer.phoneE164) },
      site: a.site ? siteOut(a.site) : null,
      openJobs: a.jobs.map((j) => ({ id: j.publicId, jobNo: j.jobNo, status: j.status, issueType: j.issueType })),
      timeline: await this.timeline(auth, a.id),
    };
  }

  async update(auth: TenantAuthContext, publicId: string, input: z.output<typeof updateAssetSchema>) {
    const tenantId = auth.membership.tenantId;
    const db = this.prisma.forTenant(tenantId);
    await db.$transaction(async (tx) => {
      const a = await tx.asset.findFirst({ where: { publicId, deletedAt: null } });
      if (!a) throw new NotFoundException('ไม่พบเครื่อง');

      const data: Prisma.AssetUncheckedUpdateInput = {
        brand: input.brand,
        model: input.model,
        serialNumber: input.serialNumber,
        installedAt: input.installedAt,
        notes: input.notes,
      };
      if (input.siteId !== undefined) {
        if (input.siteId === null) data.siteId = null;
        else {
          const site = await tx.site.findFirst({ where: { publicId: input.siteId, customerId: a.customerId, deletedAt: null } });
          if (!site) throw new BadRequestException('สถานที่ไม่ใช่ของลูกค้ารายนี้');
          data.siteId = site.id;
        }
      }
      if (input.categoryId !== undefined) {
        if (input.categoryId === null) data.categoryId = null;
        else {
          const cat = await tx.assetCategory.findFirst({ where: { publicId: input.categoryId, deletedAt: null } });
          if (!cat) throw new BadRequestException('ไม่พบประเภทเครื่อง');
          data.categoryId = cat.id;
        }
      }
      if (input.primaryMediaId !== undefined) {
        data.primaryMediaId =
          input.primaryMediaId === null ? null : (await this.media.attach(tx, [input.primaryMediaId], 'ASSET', a.id))[0];
      }

      const sources = parseJson<Record<string, string>>(a.fieldSourcesJson, {});
      for (const k of ['brand', 'model', 'serialNumber'] as const) if (input[k] !== undefined) sources[k] = 'MANUAL';
      data.fieldSourcesJson = JSON.stringify(sources);

      await tx.asset.update({ where: { id: a.id }, data });
      await appendEvent(tx, {
        tenantId,
        eventType: EventType.ASSET_UPDATED,
        actorType: 'ACCOUNT',
        actorId: auth.accountPublicId,
        subjectType: 'ASSET',
        subjectId: a.publicId,
        assetId: a.id,
        customerId: a.customerId,
        metadata: { actorName: auth.displayName, fields: Object.keys(input) },
      });
    });
    return this.detail(auth, publicId);
  }

  /** Built entirely from events — nobody types service history (req §18). */
  async timeline(auth: TenantAuthContext, assetId: number) {
    const db = this.prisma.forTenant(auth.membership.tenantId);
    const events = await db.domainEvent.findMany({
      where: { assetId, eventType: { in: ASSET_TIMELINE_EVENTS } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: 200,
      include: { job: { select: { publicId: true, jobNo: true } } },
    });
    return events.map((e) => {
      const { actorName, ...details } = parseJson<Record<string, unknown>>(e.metadataJson, {});
      return {
        type: e.eventType,
        occurredAt: e.occurredAt,
        actorName: (actorName as string | undefined) ?? null,
        job: e.job ? { id: e.job.publicId, jobNo: e.job.jobNo } : null,
        details,
      };
    });
  }
}
