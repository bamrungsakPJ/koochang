export const languages = ['th', 'en'] as const;
export type Language = (typeof languages)[number];
export const jobStatuses = ['draft', 'unassigned', 'scheduled', 'in_progress', 'completed', 'cancelled'] as const;
export type JobStatus = (typeof jobStatuses)[number];
export const membershipRoles = ['owner', 'technician'] as const;
export const subscriptionStatuses = ['trialing', 'pending_payment', 'active', 'past_due', 'expired', 'ended'] as const;
export const serviceTypes = ['installation', 'repair', 'inspection', 'maintenance', 'other'] as const;
export const foundationVersion = '0.1.0';
export interface ApiError { code: string; message: string; }
export function normalizeLanguage(value: unknown): Language {
  if (typeof value !== 'string') return 'th';
  const first = value.split(',')[0]?.trim().toLowerCase().split(';')[0]?.split('-')[0];
  return first === 'en' ? 'en' : 'th';
}
export type MembershipRole = (typeof membershipRoles)[number];
export const memberStatuses = ['pending', 'active', 'rejected', 'suspended', 'removed'] as const;
export type MemberStatus = (typeof memberStatuses)[number];
export const memberActions = ['approve', 'reject', 'suspend', 'reactivate', 'remove'] as const;
export type MemberAction = (typeof memberActions)[number];
export const joinLinkStatuses = ['active', 'closed'] as const;
export type JoinLinkStatus = (typeof joinLinkStatuses)[number];

/** Error codes shared by API and apps. Codes never change with the language. */
export const errorCodes = [
  'AUTHENTICATION_REQUIRED', 'SESSION_EXPIRED', 'TENANT_ACCESS_DENIED', 'MEMBERSHIP_INACTIVE',
  'VALIDATION_ERROR', 'RESOURCE_NOT_FOUND', 'VERSION_CONFLICT', 'INVALID_STATE_TRANSITION', 'RATE_LIMITED',
  'OTP_INVALID', 'OTP_EXPIRED', 'OTP_ATTEMPTS_EXCEEDED', 'ACCOUNT_DISABLED',
  'JOIN_LINK_INVALID', 'JOIN_LINK_CLOSED', 'SEAT_LIMIT_REACHED', 'SUBSCRIPTION_EXPIRED', 'PLAN_LIMIT_REACHED', 'ORGANIZATION_SUSPENDED',
  'TEMPORARILY_UNAVAILABLE', 'DATABASE_UNAVAILABLE', 'INVALID_REQUEST', 'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof errorCodes)[number];
export interface FieldErrors { [field: string]: string; }

/** Normalize a phone number to E.164. Thai numbers may be typed locally (08x-xxx-xxxx) or with
 * 66 / +66. Returns null when the input cannot be a valid number. The caller keeps the text the
 * user typed for display. */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const compact = input.trim().replace(/[\s\-().]/g, '');
  let e164: string;
  if (/^0\d{8,9}$/.test(compact)) e164 = `+66${compact.slice(1)}`;
  else if (/^66\d{8,9}$/.test(compact)) e164 = `+${compact}`;
  else if (/^\+\d+$/.test(compact)) e164 = compact.startsWith('+660') ? `+66${compact.slice(4)}` : compact;
  else return null;
  if (!/^\+[1-9]\d{7,14}$/.test(e164)) return null;
  if (e164.startsWith('+66') && !/^\+66\d{8,9}$/.test(e164)) return null;
  return e164;
}

/** Thai mobile numbers (06x, 08x, 09x) can receive SMS. */
export function isThaiMobile(e164: string): boolean { return /^\+66[689]\d{8}$/.test(e164); }

/** Display form: Thai numbers as 0xx-xxx-xxxx, others unchanged. */
export function formatPhone(e164: string): string {
  const m = /^\+66([689]\d)(\d{3})(\d{4})$/.exec(e164);
  if (m) return `0${m[1]}-${m[2]}-${m[3]}`;
  return e164.startsWith('+66') ? `0${e164.slice(3)}` : e164;
}
export const subscriptionStates = ['trialing', 'active', 'past_due', 'expired', 'ended', 'pending_payment', 'suspended'] as const;
export type SubscriptionState = (typeof subscriptionStates)[number];
