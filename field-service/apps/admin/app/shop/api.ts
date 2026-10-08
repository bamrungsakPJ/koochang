import type { FieldErrors, Language, MemberStatus, SubscriptionState } from '@field-service/core';
import { keys, storage } from './storage';

export const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly fieldErrors: FieldErrors = {}, readonly retryAfter?: number,
    readonly candidates: { id: string; name: string | null; phone_normalized: string | null }[] = []) {
    super(message);
  }
}
export interface Page<T> { items: T[]; limit: number; offset: number; has_more: boolean; next_offset: number | null }

export interface Membership {
  member_id: string; organization_id: string; organization_name: string | null; organization_status: string; suspension_kind?: 'temporary' | 'permanent' | null; suspended_until?: string | null;
  role: 'owner' | 'technician'; status: MemberStatus; display_name: string; version: number;
}
export interface Me { user: { id: string; display_name: string; phone_e164: string; preferred_language: Language; version: number; password_set: boolean }; memberships: Membership[]; }
export interface Challenge { challenge_id: string; reference?: string; expires_at: string; resend_after: number; delivery: 'development' | 'sms'; }
export interface JoinLink { id: string; status: 'active' | 'closed'; generation: number; version: number; url: string; qr_png: string; }
export interface TeamMember {
  member_id: string; user_id: string; role: 'owner' | 'technician'; status: MemberStatus; display_name: string;
  phone_e164: string | null; version: number; requested_at: string; open_jobs: number;
}
export interface Team { members: TeamMember[]; seats: { active_technicians: number; seat_limit: number }; }
export interface CustomerSummary { id: string; name: string | null; phone_normalized: string | null; customer_type: string; location_count: number; located_count: number; first_address: string | null; version: number; }
export interface CustomerLocation {
  id: string; label: string; address: string | null; travel_note: string | null; latitude: number | null; longitude: number | null;
  accuracy_m: number | null; capture_method: string | null; location_captured_at: string | null; version: number;
}
export interface Customer { id: string; name: string | null; phone_normalized: string | null; customer_type: string; note: string | null; version: number; locations: CustomerLocation[]; }
export interface Media { id: string; status: string; url: string | null; thumbnail_url: string | null; size_bytes: number; }
export interface OcrRequest { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'; suggestions: { fields?: { brand?: string; model?: string; serial_number?: string } } | null; }
export interface EquipmentInput { category: string; name?: string | null; brand?: string | null; model?: string | null; serial_number?: string | null; note?: string | null; }
export interface EquipmentSummary { id: string; name: string | null; category: string; brand: string | null; model: string | null; serial_number: string | null; thumbnail_url: string | null; version: number; next_due_on?: string | null; last_serviced_at?: string | null; }
export interface Equipment extends EquipmentSummary {
  location_id: string; customer_id: string; note: string | null; installed_on: string | null;
  photos: { id: string; photo_type: string; media_asset_id: string; url: string | null; thumbnail_url: string | null }[];
}
export type JobStatus = 'unassigned' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export interface JobSummary {
  id: string; status: JobStatus; job_type: string; description: string | null; scheduled_start: string | null; scheduled_end: string | null;
  estimated_equipment_count: number | null; version: number; customer_id: string; customer_name: string | null; customer_phone: string | null;
  location_id: string; location_label: string | null; location_address: string | null; current_assignee_id: string | null; assignee_name: string | null; equipment_count: number;
}
export interface Job extends JobSummary {
  cancellation_reason: string | null; started_at: string | null; completed_at: string | null; travel_note: string | null;
  latitude: number | null; longitude: number | null;
  equipment: { id: string; name: string | null; category: string; brand: string | null; model: string | null; serial_number: string | null }[];
  history: { from_status: string | null; to_status: string; reason: string | null; created_at: string; actor: string | null }[];
}
export type NextMaintenance = { mode: 'months'; interval_months: number } | { mode: 'custom_date'; due_on: string } | { mode: 'none' } | null;
export interface ServiceItemInput {
  equipment_id: string; service_type: string; outcome: 'done' | 'not_done' | 'deferred'; work_note?: string; problem_note?: string; not_done_reason?: string;
  photos: { media_asset_id: string; photo_type: 'before' | 'after' | 'issue' | 'other' }[]; next_maintenance?: NextMaintenance;
}
export interface ServiceBody { client_event_id: string; occurred_at: string; note?: string; items: ServiceItemInput[]; }
export interface ServiceResult { service_event_id: string; job_id: string; job_status: string; items: { equipment_id: string; outcome: string; next_due_on: string | null }[]; replayed?: boolean; }
export interface EquipmentHistory {
  maintenance: { service_type: string; enabled: boolean; schedule_mode: string; interval_months: number | null; due_date: string | null }[];
  items: { id: string; occurred_at: string; performed_by_name: string | null; service_type: string; outcome: string; work_note: string | null; problem_note: string | null;
    not_done_reason: string | null; next_due_on: string | null; note: string | null; photos: { photo_type: string; url: string | null; thumbnail_url: string | null }[] }[];
}
/** `renewal`: the shop's own plan at the price its next renewal uses; `change`: a scheduled plan change. */
export interface CustomerHistoryEvent {
  id: string; job_id: string | null; job_type: string | null; occurred_at: string; location_id: string; location_label: string | null; note: string | null; performed_by_name: string | null;
  equipment: { equipment_id: string; name: string | null; category: string; brand: string | null; model: string | null; service_type: string; outcome: string; work_note: string | null;
    problem_note: string | null; not_done_reason: string | null; next_due_on: string | null; photos: { photo_type: string; url: string | null; thumbnail_url: string | null }[] }[];
}
export interface CustomerHistory extends Page<CustomerHistoryEvent> {
  open_jobs: { id: string; status: JobStatus; job_type: string; scheduled_start: string | null; location_id: string; location_label: string | null; assignee_name: string | null }[];
}
export interface PlanOffer { code: string; name_th: string; name_en: string; technician_seats: number; storage_bytes: string; ocr_per_period: number; price_version_id: string; amount_minor: string; interval_unit: string;
  renewal?: boolean; change?: { effective_at: string; amount_minor: string; technician_seats: number; storage_bytes: string } | null; }
export interface InvoiceSummary { id: string; number: string; amount_minor: string; status: 'open' | 'paid' | 'voided'; created_at: string; paid_at: string | null; plan_name_th: string; plan_name_en: string; proof_status: 'pending' | 'accepted' | 'rejected' | null; }
/** Automatic card renewal through Stripe Subscription: status only, no card details. */
export interface Autopay {
  available: boolean;
  subscription: { status: string; live: boolean; cancel_at_period_end: boolean; current_period_end: string | null; canceled_by_owner: boolean; updated_at: string } | null;
}
export interface Invoice extends InvoiceSummary {
  due_at: string | null; technician_seats: number; methods?: { transfer: boolean; stripe_card: boolean; stripe_qr: boolean; stripe_test: boolean }; checkouts?: { id: string; method: 'card'|'promptpay'; status: string; reason: string|null; checkout_url: string|null; expires_at: string; mode?: 'payment' | 'subscription' }[]; proofs: { id: string; status: 'pending' | 'accepted' | 'rejected'; reason: string | null; created_at: string; verification_code?: string; verification_at?: string | null }[];
  payment: { amount_minor: string; verified_at: string; refunded_minor: string } | null; period: { start_at: string; end_at: string } | null;
  pay_to: { bank_name: string; account_name: string; account_number: string; promptpay_id: string | null; reference: string; promptpay_qr_png?: string | null } | null;
}
export interface SupportOverview {
  tickets: { id: string; subject: string; status: string; created_at: string; last_message_at: string; messages: { id: string; body: string; from_platform: boolean; created_at: string }[] | null }[];
  access: { id: string; ticket_id: string; agent: string; scope: string[]; reason: string; duration_minutes: number; status: string; valid_until: string | null; created_at: string; reads: number; consented?: boolean }[];
  data_requests: { id: string; type: string; status: string; created_at: string; completed_at: string | null; note: string | null }[];
}
export type ContactResult = 'no_answer' | 'interested' | 'call_later' | 'declined' | 'booked';
export interface MaintenanceItem {
  id: string; due_date: string; version: number; service_type: string; interval_months: number | null; equipment_id: string; equipment_name: string | null; category: string;
  brand: string | null; model: string | null; location_id: string; location_label: string; location_address: string | null; customer_id: string; customer_name: string | null;
  customer_phone: string | null; last_service_at: string | null; booked_job_id: string | null; bucket: 'overdue' | 'within_7' | 'within_30';
  last_contact: { result: ContactResult; note: string | null; next_contact_on: string | null; created_at: string } | null;
}
export interface MaintenanceList { today: string; items: MaintenanceItem[]; counts: { overdue: number; within_7: number; within_30: number } }
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

/** Shop browser API client. Attaches the access token, refreshes it once on
 * SESSION_EXPIRED, and signs out locally when the session cannot be recovered. */
export class Api {
  language: Language = 'th';
  private access: string | null = null;
  private refreshToken: string | null = null;
  private refreshing: Promise<'ok' | 'rejected' | 'unavailable'> | null = null;
  onSignedOut: () => void = () => {};
  /** Save feedback hook (the shop web shows a toast); error is the ApiFailure when not saved. */
  onSave: (ok: boolean, error?: unknown) => void = () => {};

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
    const result = await this.call<Tokens & { user_id: string; is_new_user: boolean; password_set: boolean }>('POST', '/auth/otp/verify',
      { challenge_id: challengeId, code, display_name: displayName || undefined, preferred_language: this.language }, false);
    await this.setTokens(result);
    return result;
  }
  /** Everyday sign-in: phone + password, no SMS. */
  async passwordLogin(phone: string, password: string) {
    const result = await this.call<Tokens & { user_id: string; password_set: boolean }>('POST', '/auth/password/login', { phone, password }, false);
    await this.setTokens(result);
    return result;
  }
  /** First password, a new one right after an SMS code, or a change with currentPassword. */
  setPassword(password: string, currentPassword?: string) {
    return this.call<{ password_set: true }>('POST', '/auth/password', { password, current_password: currentPassword || undefined });
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
  customers(organizationId: string, q: string, offset = 0, limit = 100) { return this.call<Page<CustomerSummary>>('GET', `/organizations/${organizationId}/customers?limit=${limit}&offset=${offset}&q=${encodeURIComponent(q)}`); }
  customer(organizationId: string, id: string) { return this.call<Customer>('GET', `/organizations/${organizationId}/customers/${id}`); }
  createCustomer(organizationId: string, body: { request_key: string; name?: string; phone?: string; note?: string; customer_type?: string; confirm_duplicate?: boolean;
    location?: { label: string; address?: string; travel_note?: string } }) { return this.call<Customer>('POST', `/organizations/${organizationId}/customers`, body); }
  updateCustomer(organizationId: string, id: string, body: { expected_version: number; name?: string; phone?: string; note?: string }) {
    return this.call<Customer>('PATCH', `/organizations/${organizationId}/customers/${id}`, body);
  }
  archiveCustomer(organizationId: string, id: string) { return this.call('POST', `/organizations/${organizationId}/customers/${id}/archive`); }
  addLocation(organizationId: string, customerId: string, body: { request_key: string; label: string; address?: string; travel_note?: string }) {
    return this.call<Customer>('POST', `/organizations/${organizationId}/customers/${customerId}/locations`, body);
  }
  updateLocation(organizationId: string, id: string, body: { expected_version: number; label?: string; address?: string | null; travel_note?: string | null }) {
    return this.call<Customer>('PATCH', `/organizations/${organizationId}/locations/${id}`, body);
  }
  saveCoordinates(organizationId: string, id: string, body: { expected_version: number; latitude: number; longitude: number; accuracy_m?: number | null; method: 'current_location' | 'manual_pin'; replace_existing?: boolean }) {
    return this.call<Customer>('PUT', `/organizations/${organizationId}/locations/${id}/coordinates`, body);
  }
  // files, OCR, equipment ---------------------------------------------------------------
  createMedia(organizationId: string, body: { request_key: string; mime_type: string; byte_size: number; purpose: string }) {
    return this.call<Media>('POST', `/organizations/${organizationId}/media`, body);
  }
  uploadMedia(organizationId: string, assetId: string, data: Blob, mimeType: string) {
    return this.call<Media>('PUT', `/organizations/${organizationId}/media/${assetId}/content`, data, true, { 'content-type': mimeType });
  }
  requestOcr(organizationId: string, mediaAssetId: string, requestKey: string) {
    return this.call<OcrRequest>('POST', `/organizations/${organizationId}/ocr-requests`, { media_asset_id: mediaAssetId, request_key: requestKey });
  }
  ocr(organizationId: string, id: string) { return this.call<OcrRequest>('GET', `/organizations/${organizationId}/ocr-requests/${id}`); }
  equipmentList(organizationId: string, locationId: string) { return this.call<{ items: EquipmentSummary[] }>('GET', `/organizations/${organizationId}/locations/${locationId}/equipment`); }
  equipment(organizationId: string, id: string) { return this.call<Equipment>('GET', `/organizations/${organizationId}/equipment/${id}`); }
  createEquipment(organizationId: string, locationId: string, body: EquipmentInput & { request_key: string; photos: { media_asset_id: string; photo_type: string }[]; ocr_request_id?: string; confirm_duplicate?: boolean }) {
    return this.call<Equipment>('POST', `/organizations/${organizationId}/locations/${locationId}/equipment`, body);
  }
  updateEquipment(organizationId: string, id: string, body: Partial<EquipmentInput> & { expected_version: number }) {
    return this.call<Equipment>('PATCH', `/organizations/${organizationId}/equipment/${id}`, body);
  }
  addEquipmentPhotos(organizationId: string, id: string, photos: { media_asset_id: string; photo_type: string }[]) {
    return this.call<Equipment>('POST', `/organizations/${organizationId}/equipment/${id}/photos`, { photos });
  }
  // jobs ------------------------------------------------------------------------------------
  jobs(organizationId: string, query: { from?: string; to?: string; status?: string; assignee?: string; limit?: string; offset?: string } = {}) {
    const q = Object.entries(query).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
    return this.call<Page<JobSummary>>('GET', `/organizations/${organizationId}/jobs${q ? `?${q}` : ''}`);
  }
  job(organizationId: string, id: string) { return this.call<Job>('GET', `/organizations/${organizationId}/jobs/${id}`); }
  updateJob(organizationId: string, id: string, body: { expected_version: number; job_type?: string; description?: string; estimated_equipment_count?: number | null; equipment_ids?: string[] }) {
    return this.call<Job>('PATCH', `/organizations/${organizationId}/jobs/${id}`, body);
  }
  createJob(organizationId: string, body: { request_key: string; customer_id: string; location_id: string; job_type: string; description?: string; scheduled_start?: string | null;
    scheduled_end?: string | null; estimated_equipment_count?: number | null; equipment_ids?: string[]; assignee_member_id?: string | null }) {
    return this.call<{ job: Job; conflicts: { id: string }[] }>('POST', `/organizations/${organizationId}/jobs`, body);
  }
  jobAction(organizationId: string, id: string, action: 'assign' | 'unassign' | 'reschedule' | 'cancel' | 'start', body: Record<string, unknown>) {
    return this.call<Job | { job: Job; conflicts: { id: string }[] }>('POST', `/organizations/${organizationId}/jobs/${id}/${action}`, body);
  }
  // service -----------------------------------------------------------------------------------
  completeJob(organizationId: string, jobId: string, body: ServiceBody & { expected_version: number }) {
    return this.call<ServiceResult>('POST', `/organizations/${organizationId}/jobs/${jobId}/complete`, body);
  }
  recordAdhoc(organizationId: string, body: ServiceBody & { customer_id: string; location_id: string }) {
    return this.call<ServiceResult>('POST', `/organizations/${organizationId}/service-events`, body);
  }
  customerHistory(organizationId: string, customerId: string, locationId?: string, offset = 0, limit = 5) {
    return this.call<CustomerHistory>('GET', `/organizations/${organizationId}/customers/${customerId}/service-history?limit=${limit}&offset=${offset}${locationId ? `&location_id=${locationId}` : ''}`);
  }
  equipmentHistory(organizationId: string, equipmentId: string) { return this.call<EquipmentHistory>('GET', `/organizations/${organizationId}/equipment/${equipmentId}/history`); }
  stripeCheckout(organizationId: string, invoiceId: string, method: 'card'|'promptpay', requestKey: string, subscribe = false) { return this.call<{id: string; url: string}>('POST', `/organizations/${organizationId}/billing/invoices/${invoiceId}/checkout`, {method, request_key: requestKey, ...(subscribe ? { subscribe: true } : {})}); }
  autopay(organizationId: string) { return this.call<Autopay>('GET', `/organizations/${organizationId}/billing/autopay`); }
  cancelAutopay(organizationId: string) { return this.call<Autopay>('POST', `/organizations/${organizationId}/billing/autopay/cancel`); }
  autopayPortal(organizationId: string) { return this.call<{ url: string }>('POST', `/organizations/${organizationId}/billing/autopay/portal`); }
  refreshCheckout(organizationId: string, invoiceId: string, id: string) { return this.call<Invoice>('POST', `/organizations/${organizationId}/billing/invoices/${invoiceId}/checkouts/${id}/refresh`); }
  cancelCheckout(organizationId: string, invoiceId: string, id: string) { return this.call<Invoice>('POST', `/organizations/${organizationId}/billing/invoices/${invoiceId}/checkouts/${id}/cancel`); }
  billingPlans(organizationId: string) { return this.call<{ payment_available: boolean; items: PlanOffer[] }>('GET', `/organizations/${organizationId}/billing/plans`); }
  invoices(organizationId: string) { return this.call<{ items: InvoiceSummary[] }>('GET', `/organizations/${organizationId}/billing/invoices`); }
  invoice(organizationId: string, id: string) { return this.call<Invoice>('GET', `/organizations/${organizationId}/billing/invoices/${id}`); }
  createInvoice(organizationId: string, priceVersionId: string, requestKey: string) {
    return this.call<Invoice>('POST', `/organizations/${organizationId}/billing/invoices`, { price_version_id: priceVersionId, request_key: requestKey });
  }
  uploadProof(organizationId: string, invoiceId: string, proofId: string, data: Blob, mimeType: string) {
    return this.call<Invoice>('PUT', `/organizations/${organizationId}/billing/invoices/${invoiceId}/proof?proof_id=${proofId}`, data, true, { 'content-type': mimeType });
  }
  support(organizationId: string) { return this.call<SupportOverview>('GET', `/organizations/${organizationId}/support`); }
  openTicket(organizationId: string, subject: string, body: string) { return this.call<{ ticket_id: string }>('POST', `/organizations/${organizationId}/support/tickets`, { subject, body }); }
  replyTicket(organizationId: string, ticketId: string, body: string) { return this.call('POST', `/organizations/${organizationId}/support/tickets/${ticketId}/messages`, { body }); }
  supportAccess(organizationId: string, grantId: string, action: 'consent' | 'refuse' | 'revoke') { return this.call('POST', `/organizations/${organizationId}/support/access/${grantId}/${action}`); }
  requestExport(organizationId: string,request_type:'export'|'closure'|'deletion'='export') { return this.call('POST', `/organizations/${organizationId}/support/data-requests`, {request_type}); }
  exportData(organizationId:string,id:string){return this.call<Record<string,unknown>>('GET',`/me/exports/${organizationId}/${id}`);}
  announcements(organizationId:string){return this.call<{items:{id:string;title_th:string;title_en:string;body_th:string;body_en:string;publish_at:string}[]}>('GET',`/organizations/${organizationId}/announcements`);}
  maintenance(organizationId: string, days = 30) { return this.call<MaintenanceList>('GET', `/organizations/${organizationId}/maintenance?days=${days}`); }
  logContact(organizationId: string, cycleId: string, body: { result: ContactResult; note?: string; next_contact_on?: string | null }) {
    return this.call('POST', `/organizations/${organizationId}/maintenance/cycles/${cycleId}/contacts`, body);
  }
  bookMaintenance(organizationId: string, body: { request_key: string; cycle_ids: string[]; assignee_member_id?: string | null; scheduled_start?: string | null; scheduled_end?: string | null; description?: string }) {
    return this.call<{ job_id: string; replayed?: boolean }>('POST', `/organizations/${organizationId}/maintenance/book`, body);
  }
  postponeCycle(organizationId: string, cycleId: string, body: { expected_version: number; due_date: string; reason: string }) {
    return this.call<{ id: string; due_date: string; version: number }>('POST', `/organizations/${organizationId}/maintenance/cycles/${cycleId}/postpone`, body);
  }
  stopCycle(organizationId: string, cycleId: string, reason: string) {
    return this.call('POST', `/organizations/${organizationId}/maintenance/cycles/${cycleId}/stop`, { reason });
  }
  notifications(organizationId: string) { return this.call<Inbox>('GET', `/organizations/${organizationId}/notifications`); }
  markRead(organizationId: string, ids?: string[]) { return this.call<Inbox>('POST', `/organizations/${organizationId}/notifications/read`, ids ? { ids } : {}); }
  subscription(organizationId: string) { return this.call<Subscription>('GET', `/organizations/${organizationId}/subscription`); }
  changeRenewal(organizationId: string, action: 'cancel-renewal' | 'resume-renewal') { return this.call<Subscription>('POST', `/organizations/${organizationId}/subscription/${action}`); }
  joinLink(organizationId: string) { return this.call<JoinLink>('GET', `/organizations/${organizationId}/join-link`); }
  changeJoinLink(organizationId: string, action: 'open' | 'close' | 'rotate') { return this.call<JoinLink>('POST', `/organizations/${organizationId}/join-link/${action}`); }

  // transport ---------------------------------------------------------------------------------
  /** Every create/update/delete shows a saved / not saved toast, except sign-in steps, marking
   * notifications read and the photo upload steps that are part of a larger save. A duplicate
   * warning is a question to the user, not a failure. */
  private async call<T = unknown>(method: string, path: string, body?: unknown, auth = true, headers: Record<string, string> = {}): Promise<T> {
    const save = method !== 'GET' && !/^\/auth\/|\/notifications\/read$|\/media(\/|$)|\/ocr-requests$|\/checkouts\/[^/]+\/refresh$/.test(path);
    try { const result = await this.request<T>(method, path, body, auth, headers); if (save) this.onSave(true); return result; }
    catch (error) {
      if (save && !(error instanceof ApiFailure && ['DUPLICATE_WARNING', 'ALREADY_BOOKED'].includes(error.code))) this.onSave(false, error);
      throw error;
    }
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown, auth = true, headers: Record<string, string> = {}, retried = false): Promise<T> {
    let response: Response;
    const usedAccess = this.access;
    try {
      response = await fetch(`${apiBaseUrl}/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'accept-language': this.language, ...(auth && this.access ? { authorization: `Bearer ${this.access}` } : {}), ...headers },
        body: body === undefined ? undefined : typeof Blob !== 'undefined' && body instanceof Blob ? body : JSON.stringify(body),
      });
    } catch { throw new ApiFailure(0, 'NETWORK_ERROR', ''); }
    const text = await response.text();
    const data = text ? safeJson(text) : null;
    if (response.ok) return data as T;
    const failure = new ApiFailure(response.status, data?.code ?? 'INTERNAL_ERROR', data?.message ?? '', data?.field_errors ?? {}, data?.retry_after, data?.candidates ?? []);
    if (auth && response.status === 401) {
      // Another client instance (second tab, hot reload) may have rotated the tokens meanwhile:
      // use the stored ones before concluding the session is gone.
      if (!retried && await this.adoptStoredTokens(usedAccess)) return this.request<T>(method, path, body, auth, headers, true);
      if (failure.code === 'SESSION_EXPIRED' && !retried) {
        const refreshed = await this.refresh();
        if (refreshed === 'ok') return this.request<T>(method, path, body, auth, headers, true);
        // Network or server trouble while refreshing is not a reason to sign out: keep the
        // tokens and let the user retry once the service is reachable.
        if (refreshed === 'unavailable') throw new ApiFailure(0, 'NETWORK_ERROR', '');
      }
      await this.setTokens(null);
      this.onSignedOut();
    }
    throw failure;
  }

  private async adoptStoredTokens(usedAccess: string | null): Promise<boolean> {
    const access = await storage.get(keys.access);
    if (!access || access === usedAccess) return false;
    this.access = access;
    this.refreshToken = await storage.get(keys.refresh);
    return true;
  }

  /** ok: new tokens stored; rejected: the server refused the refresh token; unavailable: try later. */
  private refresh(): Promise<'ok' | 'rejected' | 'unavailable'> {
    this.refreshing ??= (async () => {
      const usedRefresh = this.refreshToken;
      try {
        if (!this.refreshToken) return 'rejected' as const;
        const tokens = await this.request<Tokens>('POST', '/auth/refresh', { refresh_token: this.refreshToken }, false);
        await this.setTokens(tokens);
        return 'ok' as const;
      } catch (error) {
        if (!(error instanceof ApiFailure && error.status === 401)) return 'unavailable' as const;
        // Someone else refreshed first: their tokens are in storage.
        const stored = await storage.get(keys.refresh);
        if (stored && stored !== usedRefresh) { this.refreshToken = stored; this.access = await storage.get(keys.access); return 'ok' as const; }
        return 'rejected' as const;
      } finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }
}

function safeJson(text: string) { try { return JSON.parse(text); } catch { return null; } }

/** Accepts a full join URL (https://…/join/<token>, koochang://join/<token>) or the bare token. */
export function tokenFromLink(text: string): string | null {
  const trimmed = text.trim();
  const match = /(?:^|\/join\/)([A-Za-z0-9_-]{43})(?:[/?#].*)?$/.exec(trimmed);
  return match ? match[1]! : null;
}

export const api = new Api();

