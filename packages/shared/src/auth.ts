import { z } from 'zod';
import { OtpPurpose, Role } from './enums';
import { isThaiMobile, normalizeThaiPhone } from './phone';

/** Accepts any typed Thai format, outputs E.164. */
export const thaiPhone = z
  .string()
  .transform((v, ctx) => {
    const e164 = normalizeThaiPhone(v);
    if (!e164) {
      ctx.addIssue({ code: 'custom', message: 'เบอร์โทรไม่ถูกต้อง' });
      return z.NEVER;
    }
    return e164;
  });

export const thaiMobile = thaiPhone.refine(isThaiMobile, 'ต้องเป็นเบอร์มือถือ');

const password = z.string().min(8, 'รหัสผ่านอย่างน้อย 8 ตัวอักษร').max(128);

export const otpRequestSchema = z.object({
  phone: thaiMobile,
  purpose: z.enum([OtpPurpose.SIGNUP, OtpPurpose.RESET]),
});

export const otpVerifySchema = z.object({
  phone: thaiMobile,
  purpose: z.enum([OtpPurpose.SIGNUP, OtpPurpose.RESET]),
  code: z.string().regex(/^\d{6}$/),
});

export const signupSchema = z.object({
  verificationToken: z.string().min(1),
  shopName: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(200),
  password,
});

export const loginSchema = z.object({
  phone: thaiPhone,
  password: z.string().min(1),
});

export const passwordResetSchema = z.object({
  verificationToken: z.string().min(1),
  password,
});

export const switchTenantSchema = z.object({
  tenantId: z.string().min(1),
});

export const createInviteSchema = z.object({
  role: z.enum([Role.ADMIN, Role.DISPATCHER, Role.TECHNICIAN]).default(Role.TECHNICIAN),
});

export const acceptInviteSchema = z.object({
  lineIdToken: z.string().min(1),
  displayName: z.string().trim().min(1).max(200),
  phone: thaiPhone.optional(),
});

export const lineLoginSchema = z.object({
  lineIdToken: z.string().min(1),
});
