import type { FieldErrors, Language, MemberStatus, SubscriptionState } from '@field-service/core';
import { keys, storage } from './storage';

export const apiBaseUrl = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly fieldErrors: FieldErrors = {}, readonly retryAfter?: number) {
    super(message);
  }
}

export interface Membership {
  member_id: string; organization_id: string; organization_name: string | null; organization_status: string;
  role: 'owner' | 'technician'; status: MemberStatus; display_name: string; version: number;
}
export interface Me { user: { id: string; display_name: string; phone_e164: string; preferred_language: Language; version: number }; memberships: Membership[]; }
export interface Challenge { challenge_id: string; expires_at: string; resend_after: number; delivery: 'development' | 'sms'; }
export interface JoinLink { id: string; status: 'active' | 'closed'; generation: number; version: number; url: string; qr_png: string; }
export interface TeamMember {
  member_id: string; user_id: string; role: 'owner' | 'technician'; status: MemberStatus; display_name: string;
  phone_e164: string | null; version: number; requested_at: string; open_jobs: number;
}
export interface Team { members: TeamMember[]; seats: { active_technicians: number; seat_limit: number }; }
export interface InboxItem { id: string; template_key: string; parameters: Record<string, string | number>; target_type: string | null; target_id: string | null; created_at: string; read_at: string | null; }
export interface Inbox { items: InboxItem[]; unread: number; }
/** Owners get the full object; technicians only state and writable. */
export interface Subscription {
  state: SubscriptionState; writable: boolean; source?: 'trial' | 'paid' | 'complimentary' | 'grant' | null;
  plan?: { code: string; name_th: string; name_en: string } | null;
  period_end?: string | null; grace_until?: string | null; cancel_at_period_end?: boolean;
  limits?: { technician_seats: number; storage_bytes: number; ocr_per_period: number };
  usage?: { technician_seats: number; storage_bytes: number; ocr: number };
}
interface Tokens { access_token: string; refresh_token: string; }

/** Thin client for the A02 API. Attaches the access token, refreshes it once on
 * SESSION_EXPIRED, and signs out locally when the session cannot be recovered. */
export class Api {
  language: Language = 'th';
  private access: string | null = null;
  private refreshToken: string | null = null;
  private refreshing: Promise<'ok' | 'rejected' | 'unavailable'> | null = null;
  onSignedOut: () => void = () => {};

  async restore(): Promise<boolean> {
    this.access = await storage.get(keys.access);
    this.refreshToken = await storage.get(keys.refresh);
    return Boolean(this.access && this.refreshToken);
  }
  get signedIn() { return Boolean(this.access); }

  async setTokens(tokens: Tokens | null) {
    this.access = tokens?.access_token ?? null;
    this.refreshToken = tokens?.refresh_token ?? null;
    await storage.set(keys.access, this.access);
    await storage.set(keys.refresh, this.refreshToken);
  }

  // auth --------------------------------------------------------------------------------------
  requestOtp(phone: string) { return this.call<Challenge>('POST', '/auth/otp/request', { phone }, false); }
  async verifyOtp(challengeId: string, code: string, displayName?: string) {
    const result = await this.call<Tokens & { user_id: string; is_new_user: boolean }>('POST', '/auth/otp/verify',
      { challenge_id: challengeId, code, display_name: displayName || undefined, preferred_language: this.language }, false);
    await this.setTokens(result);
    return result;
  }
  async signOut() {
    try { if (this.access) await this.call('POST', '/auth/logout'); } catch { /* already invalid */ }
    await this.setTokens(null);
  }
  me() { return this.call<Me>('GET', '/me'); }
  updateMe(body: { preferred_language?: Language; display_name?: string }) { return this.call<Me>('PATCH', '/me', body); }

  // shops -------------------------------------------------------------------------------------
  createOrganization(name: string, idempotencyKey: string) {
    return this.call<{ organization: { id: string; name: string }; join_link: JoinLink | null }>('POST', '/organizations',
      { name, preferred_language: this.language }, true, { 'idempotency-key': idempotencyKey });
  }
  previewJoinLink(token: string) { return this.call<{ state: 'active' | 'closed' | 'invalid'; organization_name: string | null }>('GET', `/join-links/${token}`, undefined, false); }
  requestJoin(token: string, displayName: string) {
    return this.call<{ organization_id: string; organization_name: string; member_id: string; status: MemberStatus }>('POST', '/join-requests', { token, display_name: displayName });
  }
  team(organizationId: string) { return this.call<Team>('GET', `/organizations/${organizationId}/members`); }
  changeMember(organizationId: string, memberId: string, action: string, expectedVersion: number) {
    return this.call('POST', `/organizations/${organizationId}/members/${memberId}/${action}`, { expected_version: expectedVersion });
  }
  notifications(organizationId: string) { return this.call<Inbox>('GET', `/organizations/${organizationId}/notifications`); }
  markRead(organizationId: string, ids?: string[]) { return this.call<Inbox>('POST', `/organizations/${organizationId}/notifications/read`, ids ? { ids } : {}); }
  subscription(organizationId: string) { return this.call<Subscription>('GET', `/organizations/${organizationId}/subscription`); }
  changeRenewal(organizationId: string, action: 'cancel-renewal' | 'resume-renewal') { return this.call<Subscription>('POST', `/organizations/${organizationId}/subscription/${action}`); }
  joinLink(organizationId: string) { return this.call<JoinLink>('GET', `/organizations/${organizationId}/join-link`); }
  changeJoinLink(organizationId: string, action: 'open' | 'close' | 'rotate') { return this.call<JoinLink>('POST', `/organizations/${organizationId}/join-link/${action}`); }

  // transport ---------------------------------------------------------------------------------
  private async call<T = unknown>(method: string, path: string, body?: unknown, auth = true, headers: Record<string, string> = {}, retried = false): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'accept-language': this.language, ...(auth && this.access ? { authorization: `Bearer ${this.access}` } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { throw new ApiFailure(0, 'NETWORK_ERROR', ''); }
    const text = await response.text();
    const data = text ? safeJson(text) : null;
    if (response.ok) return data as T;
    const failure = new ApiFailure(response.status, data?.code ?? 'INTERNAL_ERROR', data?.message ?? '', data?.field_errors ?? {}, data?.retry_after);
    if (auth && response.status === 401) {
      if (failure.code === 'SESSION_EXPIRED' && !retried) {
        const refreshed = await this.refresh();
        if (refreshed === 'ok') return this.call<T>(method, path, body, auth, headers, true);
        // Network or server trouble while refreshing is not a reason to sign out: keep the
        // tokens and let the user retry once the service is reachable.
        if (refreshed === 'unavailable') throw new ApiFailure(0, 'NETWORK_ERROR', '');
      }
      await this.setTokens(null);
      this.onSignedOut();
    }
    throw failure;
  }

  /** ok: new tokens stored; rejected: the server refused the refresh token; unavailable: try later. */
  private refresh(): Promise<'ok' | 'rejected' | 'unavailable'> {
    this.refreshing ??= (async () => {
      try {
        if (!this.refreshToken) return 'rejected' as const;
        const tokens = await this.call<Tokens>('POST', '/auth/refresh', { refresh_token: this.refreshToken }, false);
        await this.setTokens(tokens);
        return 'ok' as const;
      } catch (error) {
        return error instanceof ApiFailure && error.status === 401 ? 'rejected' as const : 'unavailable' as const;
      } finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }
}

function safeJson(text: string) { try { return JSON.parse(text); } catch { return null; } }

/** Accepts a full join URL (https://…/join/<token>, fieldservice://join/<token>) or the bare token. */
export function tokenFromLink(text: string): string | null {
  const trimmed = text.trim();
  const match = /(?:^|\/join\/)([A-Za-z0-9_-]{43})(?:[/?#].*)?$/.exec(trimmed);
  return match ? match[1]! : null;
}

export const api = new Api();
