import { Injectable, NotFoundException } from '@nestjs/common';
import { createCustomerSchema, formatThaiPhone, OPEN_JOB_STATUSES, siteInputSchema, updateCustomerSchema } from '@serviceflow/shared';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { TenantAuthContext } from '../../common/auth/auth-context';
import { appendEvent, EventType } from '../../common/events';
import { newPublicId } from '../../common/ids';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { TenantDb } from '../../common/prisma/tenant-scope';
import { MediaService } from '../media/media.service';

type TenantTx = Parameters<Parameters<TenantDb['$transaction']>[0]>[0];
type SiteInput = z.output<typeof siteInputSchema>;

export const phoneOut = (e164: string | null) => (e164 ? formatThaiPhone(e164) : null);

export function siteOut(s: { publicId: string; displayName: string; lat: number | null; lng: number | null; addressText: string | null; notes: string | null }) {
  return { id: s.publicId, displayName: s.displayName, lat: s.lat, lng: s.lng, addressText: s.addressText, notes: s.notes };
}

/** Forgiving search input: "081-234", "0812345678", "+66 81…" all match the stored +66 number. */
function phoneFragment(q: string): string | null {
  const digits = q.replace(/\D/g, '');
  if (digits.length < 3 || digits.length !== q.replace(/[\s\-+().]/g, '').length) return null;
  if (digits.startsWith('66')) return digits.slice(2);
  if (digits.startsWith('0')) return digits.slice(1);
  return digits;
}

@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async create(auth: TenantAuthContext, input: z.output<typeof createCustomerSchema>) {
    const db = this.prisma.forTenant(auth.membership.tenantId);
    const customer = await db.$transaction((tx) => this.createInTx(tx, auth, input));
    return this.detail(auth, customer.publicId);
  }

  /** Also used by quick asset creation (new customer inline). */
  async createInTx(
    tx: TenantTx,
    auth: TenantAuthContext,
    input: { displayName: string; phone?: string; notes?: string; site?: SiteInput },
  ) {
    const customer = await tx.customer.create({
      data: {
        publicId: newPublicId(),
        tenantId: auth.membership.tenantId,
        displayName: input.displayName,
        phoneE164: input.phone,
        notes: input.notes,
      },
    });
    await appendEvent(tx, {
      tenantId: auth.membership.tenantId,
      eventType: EventType.CUSTOMER_CREATED,
      actorType: 'ACCOUNT',
      actorId: auth.accountPublicId,
      subjectType: 'CUSTOMER',
      subjectId: customer.publicId,
      customerId: customer.id,
      metadata: { actorName: auth.displayName },
    });
    if (input.site) await this.createSiteInTx(tx, auth, customer.id, input.site);
    return customer;
  }

  async createSiteInTx(tx: TenantTx, auth: TenantAuthContext, customerId: number, input: SiteInput) {
    const count = await tx.site.count({ where: { customerId, deletedAt: null } });
    const site = await tx.site.create({
      data: {
        publicId: newPublicId(),
        tenantId: auth.membership.tenantId,
        customerId,
        // Location first, name optional: default to a sensible label.
        displayName: input.displayName ?? (count === 0 ? 'สถานที่หลัก' : `สถานที่ ${count + 1}`),
        lat: input.lat,
        lng: input.lng,
        addressText: input.addressText,
        notes: input.notes,
      },
    });
    await appendEvent(tx, {
      tenantId: auth.membership.tenantId,
      eventType: EventType.SITE_CREATED,
      actorType: 'ACCOUNT',
      actorId: auth.accountPublicId,
      subjectType: 'SITE',
      subjectId: site.publicId,
      customerId,
      metadata: { actorName: auth.displayName, displayName: site.displayName },
    });
    return site;
  }

  async search(auth: TenantAuthContext, q: string | undefined, limit = 20) {
    const db = this.prisma.forTenant(auth.membership.tenantId);
    const term = q?.trim() ?? '';
    const where: Prisma.CustomerWhereInput = { deletedAt: null };
    if (term) {
      const phone = phoneFragment(term);
      where.OR = [
        { displayName: { contains: term } },
        { sites: { some: { deletedAt: null, OR: [{ displayName: { contains: term } }, { addressText: { contains: term } }] } } },
        { assets: { some: { deletedAt: null, OR: [{ serialNumber: { contains: term } }, { model: { contains: term } }] } } },
        ...(phone ? [{ phoneE164: { contains: phone } }] : []),
      ];
    }
    const rows = await db.customer.findMany({
      where,
      orderBy: term ? { displayName: 'asc' } : { updatedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
      include: { _count: { select: { assets: { where: { deletedAt: null } } } } },
    });
    return rows.map((c) => ({
      id: c.publicId,
      displayName: c.displayName,
      phone: phoneOut(c.phoneE164),
      assetCount: c._count.assets,
    }));
  }

  async detail(auth: TenantAuthContext, publicId: string) {
    const db = this.prisma.forTenant(auth.membership.tenantId);
    const c = await db.customer.findFirst({
      where: { publicId, deletedAt: null },
      include: {
        sites: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        assets: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: { category: true, site: true },
        },
        jobs: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { asset: { include: { category: true } } },
        },
      },
    });
    if (!c) throw new NotFoundException('ไม่พบลูกค้า');

    const media = await db.media.findMany({
      where: { id: { in: c.assets.map((a) => a.primaryMediaId).filter((x): x is number => x !== null) } },
      select: { id: true, publicId: true },
    });
    const mediaById = new Map(media.map((m) => [m.id, m.publicId]));

    return {
      id: c.publicId,
      displayName: c.displayName,
      phone: phoneOut(c.phoneE164),
      notes: c.notes,
      sites: c.sites.map(siteOut),
      assets: c.assets.map((a) => ({
        id: a.publicId,
        category: a.category?.name ?? null,
        brand: a.brand,
        model: a.model,
        serialNumber: a.serialNumber,
        siteName: a.site?.displayName ?? null,
        installedAt: a.installedAt,
        photoUrl: a.primaryMediaId && mediaById.has(a.primaryMediaId) ? this.media.signedUrl(mediaById.get(a.primaryMediaId)!) : null,
      })),
      jobs: c.jobs.map((j) => ({
        id: j.publicId,
        jobNo: j.jobNo,
        status: j.status,
        issueType: j.issueType,
        assetLabel: j.asset ? assetLabel(j.asset) : null,
        createdAt: j.createdAt,
        open: (OPEN_JOB_STATUSES as string[]).includes(j.status),
      })),
    };
  }

  async update(auth: TenantAuthContext, publicId: string, input: z.output<typeof updateCustomerSchema>) {
    const db = this.prisma.forTenant(auth.membership.tenantId);
    await db.$transaction(async (tx) => {
      const c = await tx.customer.findFirst({ where: { publicId, deletedAt: null } });
      if (!c) throw new NotFoundException('ไม่พบลูกค้า');
      await tx.customer.update({
        where: { id: c.id },
        data: { displayName: input.displayName, phoneE164: input.phone, notes: input.notes },
      });
      await appendEvent(tx, {
        tenantId: auth.membership.tenantId,
        eventType: EventType.CUSTOMER_UPDATED,
        actorType: 'ACCOUNT',
        actorId: auth.accountPublicId,
        subjectType: 'CUSTOMER',
        subjectId: c.publicId,
        customerId: c.id,
        metadata: { actorName: auth.displayName, fields: Object.keys(input) },
      });
    });
    return this.detail(auth, publicId);
  }

  async addSite(auth: TenantAuthContext, customerPublicId: string, input: SiteInput) {
    const db = this.prisma.forTenant(auth.membership.tenantId);
    const site = await db.$transaction(async (tx) => {
      const c = await tx.customer.findFirst({ where: { publicId: customerPublicId, deletedAt: null } });
      if (!c) throw new NotFoundException('ไม่พบลูกค้า');
      return this.createSiteInTx(tx, auth, c.id, input);
    });
    return siteOut(site);
  }
}

export function assetLabel(a: { brand: string | null; model: string | null; category?: { name: string } | null }): string {
  const name = [a.brand, a.model].filter(Boolean).join(' ');
  return name || a.category?.name || 'เครื่อง';
}
