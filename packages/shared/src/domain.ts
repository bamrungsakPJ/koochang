import { z } from 'zod';
import { thaiPhone } from './auth';

// ───────────── Jobs ─────────────

export const JobStatus = {
  NEW: 'NEW',
  ASSIGNED: 'ASSIGNED',
  ACCEPTED: 'ACCEPTED',
  ON_THE_WAY: 'ON_THE_WAY',
  ON_SITE: 'ON_SITE',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING_PART: 'WAITING_PART',
  NEED_RETURN_VISIT: 'NEED_RETURN_VISIT',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const jobStatusLabel: Record<JobStatus, string> = {
  NEW: 'งานใหม่',
  ASSIGNED: 'มอบหมายแล้ว',
  ACCEPTED: 'ช่างรับงาน',
  ON_THE_WAY: 'กำลังเดินทาง',
  ON_SITE: 'ถึงหน้างาน',
  IN_PROGRESS: 'กำลังทำงาน',
  WAITING_PART: 'รออะไหล่',
  NEED_RETURN_VISIT: 'ต้องกลับไปอีกครั้ง',
  COMPLETED: 'เสร็จแล้ว',
  CANCELLED: 'ยกเลิก',
};

/** Statuses where the job is still open. */
export const OPEN_JOB_STATUSES: JobStatus[] = [
  JobStatus.NEW,
  JobStatus.ASSIGNED,
  JobStatus.ACCEPTED,
  JobStatus.ON_THE_WAY,
  JobStatus.ON_SITE,
  JobStatus.IN_PROGRESS,
  JobStatus.WAITING_PART,
  JobStatus.NEED_RETURN_VISIT,
];

export const JobSource = {
  QR: 'QR',
  LINE: 'LINE',
  ADMIN: 'ADMIN',
  TECH: 'TECH',
  PM: 'PM',
  API: 'API',
} as const;
export type JobSource = (typeof JobSource)[keyof typeof JobSource];

/** "What was done?" choices (req §16). */
export const WorkType = {
  CLEAN_PM: 'CLEAN_PM',
  REPAIR: 'REPAIR',
  REPLACE_PART: 'REPLACE_PART',
  ADJUSTMENT: 'ADJUSTMENT',
  OTHER: 'OTHER',
} as const;
export type WorkType = (typeof WorkType)[keyof typeof WorkType];

export const workTypeLabel: Record<WorkType, string> = {
  CLEAN_PM: 'ล้าง / PM',
  REPAIR: 'ซ่อม',
  REPLACE_PART: 'เปลี่ยนอะไหล่',
  ADJUSTMENT: 'ปรับตั้ง',
  OTHER: 'อื่น ๆ',
};

export const MediaKind = {
  NAMEPLATE: 'NAMEPLATE',
  ASSET: 'ASSET',
  BEFORE: 'BEFORE',
  AFTER: 'AFTER',
  ISSUE: 'ISSUE',
  PART: 'PART',
} as const;
export type MediaKind = (typeof MediaKind)[keyof typeof MediaKind];

// ───────────── Asset categories (seeded per shop, editable later) ─────────────

export const DEFAULT_ASSET_CATEGORIES: { name: string; issueTypes: string[] }[] = [
  { name: 'แอร์', issueTypes: ['ไม่เย็น', 'น้ำหยด', 'มีเสียงดัง', 'เปิดไม่ติด', 'มีกลิ่น', 'อื่น ๆ'] },
  { name: 'เครื่องกรองน้ำ', issueTypes: ['น้ำไหลช้า', 'น้ำมีกลิ่น/รส', 'รั่วซึม', 'ถึงรอบเปลี่ยนไส้กรอง', 'อื่น ๆ'] },
  { name: 'กล้องวงจรปิด', issueTypes: ['ภาพไม่ขึ้น', 'ดูออนไลน์ไม่ได้', 'บันทึกไม่ได้', 'อื่น ๆ'] },
  { name: 'ปั๊มน้ำ', issueTypes: ['ไม่ทำงาน', 'แรงดันต่ำ', 'ตัดต่อบ่อย', 'มีเสียงดัง', 'รั่วซึม', 'อื่น ๆ'] },
  { name: 'อื่น ๆ', issueTypes: ['เสีย/ใช้งานไม่ได้', 'มีเสียงดัง', 'ตรวจเช็ก/บำรุงรักษา', 'อื่น ๆ'] },
];

// ───────────── Request schemas ─────────────

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const publicId = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'รหัสไม่ถูกต้อง');

export const siteInputSchema = z.object({
  displayName: optionalText(200),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  addressText: optionalText(500),
  notes: optionalText(2000),
});

export const createCustomerSchema = z.object({
  displayName: z.string().trim().min(1, 'กรุณาใส่ชื่อลูกค้า').max(200),
  phone: thaiPhone.optional(),
  notes: optionalText(2000),
  /** Optional first site so a new customer + location is one step. */
  site: siteInputSchema.optional(),
});

export const updateCustomerSchema = z.object({
  displayName: z.string().trim().min(1).max(200).optional(),
  phone: thaiPhone.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const createSiteSchema = siteInputSchema;

/**
 * Zero-form asset creation (req §8): an existing or quick-added customer is the only must.
 * Everything else can be filled in later.
 */
export const createAssetSchema = z
  .object({
    customerId: publicId.optional(),
    newCustomer: z.object({ displayName: z.string().trim().min(1).max(200), phone: thaiPhone.optional() }).optional(),
    siteId: publicId.optional(),
    newSite: siteInputSchema.optional(),
    categoryId: publicId.optional(),
    brand: optionalText(100),
    model: optionalText(100),
    serialNumber: optionalText(100),
    installedAt: z.coerce.date().optional(),
    primaryMediaId: publicId.optional(),
    notes: optionalText(2000),
  })
  .refine((v) => Boolean(v.customerId) !== Boolean(v.newCustomer), {
    message: 'เลือกลูกค้าเดิม หรือเพิ่มลูกค้าใหม่อย่างใดอย่างหนึ่ง',
    path: ['customerId'],
  })
  .refine((v) => !(v.siteId && v.newSite), { message: 'เลือกสถานที่เดิม หรือเพิ่มใหม่อย่างใดอย่างหนึ่ง', path: ['siteId'] });

export const updateAssetSchema = z.object({
  siteId: publicId.nullable().optional(),
  categoryId: publicId.nullable().optional(),
  brand: z.string().trim().max(100).nullable().optional(),
  model: z.string().trim().max(100).nullable().optional(),
  serialNumber: z.string().trim().max(100).nullable().optional(),
  installedAt: z.coerce.date().nullable().optional(),
  primaryMediaId: publicId.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const createJobSchema = z
  .object({
    assetId: publicId.optional(),
    /** Needed only when there is no asset (e.g. customer called about something not registered yet). */
    customerId: publicId.optional(),
    siteId: publicId.optional(),
    issueType: optionalText(100),
    issueNote: optionalText(2000),
    assigneeId: publicId.optional(),
    scheduledFor: z.coerce.date().optional(),
  })
  .refine((v) => v.assetId || v.customerId, { message: 'เลือกเครื่องหรือลูกค้า', path: ['assetId'] });

export const assignJobSchema = z.object({ assigneeId: publicId });

export const needPartSchema = z
  .object({ description: optionalText(500), mediaId: publicId.optional() })
  .refine((v) => v.description || v.mediaId, { message: 'บอกชื่ออะไหล่หรือถ่ายรูป', path: ['description'] });

export const needReturnSchema = z.object({ note: optionalText(2000) });

export const partUsedSchema = z.object({
  name: z.string().trim().min(1).max(200),
  spec: optionalText(100),
  qty: z.number().int().min(1).max(999).default(1),
});

export const completeJobSchema = z.object({
  workTypes: z.array(z.enum(Object.values(WorkType) as [WorkType, ...WorkType[]])).min(1, 'เลือกสิ่งที่ทำอย่างน้อย 1 อย่าง'),
  parts: z.array(partUsedSchema).max(50).default([]),
  note: optionalText(2000),
  mediaIds: z.array(publicId).max(20).default([]),
});

export const cancelJobSchema = z.object({ reason: optionalText(500) });
