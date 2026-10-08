'use client';
import { Fragment, useEffect, useState, type FormEvent } from 'react';
import type { AdminKey } from '@field-service/i18n';
import { DatabaseZap, KeyRound, LifeBuoy, ReceiptText, RotateCcw, type LucideIcon } from 'lucide-react';
import { ShopFilter } from './shop-picker';
import { call, ConsoleError, dateOnly, dateTime, isSuperAdmin, money, useAsk, useCode, useLanguage, useStepUp, useText, type Me } from './api';

const message = (e: unknown) => e instanceof ConsoleError ? e.message : String(e);
const states = ['trialing', 'active', 'past_due', 'expired', 'ended', 'pending_payment', 'suspended'];
const scopes = ['customers', 'equipment', 'jobs', 'service_history'] as const;
const gb = (bytes: number | string) => `${(Number(bytes) / 1e9).toFixed(Number(bytes) < 1e9 ? 2 : 1)} GB`;

function Pill({ group, value }: { group: string; value: string | null | undefined }) {
  const t = useText();
  if (!value) return <span className="pill">—</span>;
  const tone = ['active', 'succeeded', 'resolved', 'closed', 'trialing'].includes(value) ? 'ok'
    : ['suspended', 'expired', 'rejected', 'revoked', 'cancelled'].includes(value) ? 'bad' : ['in_progress', 'approved', 'running'].includes(value) ? 'info' : 'warn';
  return <span className={`pill ${tone}`}>{t(`${group}.${value}` as AdminKey)}</span>;
}

/** Previous/next for lists the API returns 50 rows at a time. */
export function Pager({ offset, hasMore, busy, onChange }: { offset: number; hasMore: boolean; busy?: boolean; onChange: (offset: number) => void }) {
  const t = useText();
  if (!offset && !hasMore) return null;
  return <div className="actions pager">
    <button disabled={!offset || busy} onClick={() => onChange(Math.max(0, offset - 50))}>{t('backPage')}</button>
    <span className="muted">{offset + 1}–{offset + 50}</span>
    <button disabled={!hasMore || busy} onClick={() => onChange(offset + 50)}>{t('nextPage')}</button>
  </div>;
}
export type Page<T> = { items: T[]; has_more: boolean; offset: number };

interface IncidentSummary { open: { id: string; title: string; severity: string; status: string; services: string[]; created_at: string }[];
  last_resolved: { title: string; minutes: number; updated_at: string } | null; resolved_30d: number }
const severityKey: Record<string, AdminKey> = { low: 'severityLow', medium: 'severityMedium', high: 'severityHigh', critical: 'severityCritical' };

export function OverviewView({ onNavigate }: { onNavigate: (view: string) => void }) {
  const t = useText();
  const lang = useLanguage();
  const [data, setData] = useState<{ shops: Record<string, number> | null; proofs_pending: number; refunds_open: number; tickets_open: number; access_pending: number; data_requests_open: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [m, setM] = useState<Record<string, number | null> | null>(null);
  const [incidents, setIncidents] = useState<IncidentSummary | null>(null);
  useEffect(() => {
    call<typeof data>('GET', '/platform/overview').then(setData, e => setError(message(e)));
    call<Record<string, number | null>>('GET', '/platform/metrics?days=30').then(setM, () => setM(null));
    // Only accounts with system.read see incidents; others simply get no panel.
    call<IncidentSummary>('GET', '/platform/incidents/summary').then(setIncidents, () => setIncidents(null));
  }, []);
  const pct = (a?: number | null, b?: number | null) => (b ? `${Math.round(((a ?? 0) / b) * 100)}%` : '–');
  const tiles: [AdminKey, number | undefined, string, string, LucideIcon][] = [
    ['proofsPending', data?.proofs_pending, 'payments', 'amber', ReceiptText], ['refundsOpen', data?.refunds_open, 'refunds', 'rose', RotateCcw], ['ticketsOpen', data?.tickets_open, 'support', 'sky', LifeBuoy],
    ['accessPending', data?.access_pending, 'access', 'violet', KeyRound], ['dataOpen', data?.data_requests_open, 'data', 'teal', DatabaseZap],
  ];
  return <section>
    <h1>{t('navOverview')}</h1>
    {error ? <p className="error">{error}</p> : null}
    <div className="tiles">{tiles.map(([key, n, view, tone, Icon]) => <button key={key} className={`tile ${tone}`} onClick={() => onNavigate(view)}><span className="tile-icon"><Icon size={18} /></span><strong>{n ?? '–'}</strong><span>{t(key)}</span></button>)}</div>
    {incidents ? <div className="panel">
      <h2>{t('openIncidents')}</h2>
      {incidents.open.length ? <ul className="incident-list">{incidents.open.map(i => <li key={i.id}>
        <button className="link" onClick={() => onNavigate('communications')}>{i.title}</button>{' '}
        <span className={`pill ${['critical', 'high'].includes(i.severity) ? 'bad' : 'warn'}`}>{t(severityKey[i.severity] ?? 'status')}</span>
        <span className="muted"> · {i.services.join(', ').toUpperCase()} · {dateTime(i.created_at, lang)}</span></li>)}</ul>
        : <p className="ok-box">{t('noOpenIncidents')}</p>}
      <p className="muted">{incidents.last_resolved ? t('lastResolved', { title: incidents.last_resolved.title, minutes: incidents.last_resolved.minutes }) : null}
        {incidents.last_resolved ? ' · ' : null}{t('resolved30d', { n: incidents.resolved_30d })}</p>
    </div> : null}
    <div className="panel">
      <h2>{t('shopsByState')}</h2>
      <div className="tiles small">{states.map(s => <div key={s} className="tile plain"><strong>{data?.shops?.[s] ?? 0}</strong><span>{t(`state.${s}` as AdminKey)}</span></div>)}</div>
    </div>
    {m ? <div className="panel">
      <h2>{t('metrics', { days: m.days ?? 30 })}</h2>
      <div className="tiles small">
        <div className="tile plain"><strong>{m.service_records ?? 0}</strong><span>{t('serviceRecords')}</span></div>
        <div className="tile plain"><strong>{m.record_minutes_median ?? '–'}</strong><span>{t('recordMinutes')}</span></div>
        <div className="tile plain"><strong>{m.history_coverage === null || m.history_coverage === undefined ? '–' : `${Math.round(Number(m.history_coverage) * 100)}%`}</strong><span>{t('historyCoverage')}</span></div>
        <div className="tile plain"><strong>{pct(m.maintenance_followed, m.maintenance_due)}</strong><span>{t('maintenanceFollowed')} ({m.maintenance_followed ?? 0}/{m.maintenance_due ?? 0})</span></div>
        <div className="tile plain"><strong>{m.active_shops ?? 0}/{m.shops_total ?? 0}</strong><span>{t('activeShops')}</span></div>
        <div className="tile plain"><strong>{m.active_technicians ?? 0}</strong><span>{t('activeTechnicians')}</span></div>
        <div className="tile plain"><strong>{pct(m.trial_converted, m.trial_ended)}</strong><span>{t('trialConversion')} ({m.trial_converted ?? 0}/{m.trial_ended ?? 0})</span></div>
        <div className="tile plain"><strong>{gb(m.storage_bytes ?? 0)}</strong><span>{t('storageTotal')}</span></div>
        <div className="tile plain"><strong>{m.ocr_used ?? 0}</strong><span>{t('ocrUsed')}</span></div>
      </div>
    </div> : null}
  </section>;
}

interface ShopRow { id: string; name: string; status: string; created_at: string; state: string; plan_code: string | null; period_end: string | null; owner_name: string | null; owner_phone: string | null; active_technicians: number }

export function ShopsView({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useText();
  const lang = useLanguage();
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [rows, setRows] = useState<ShopRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const load = (event?: FormEvent, at = 0) => { event?.preventDefault(); setRows(null); setError(null); setOffset(at);
    call<Page<ShopRow>>('GET', `/platform/shops?q=${encodeURIComponent(q)}&state=${state}&offset=${at}`).then(r => { setRows(r.items); setHasMore(r.has_more); }, e => setError(message(e))); };
  useEffect(() => { load(); }, [state]);
  return <section>
    <h1>{t('navShops')}</h1>
    <form className="inline" onSubmit={load}>
      <label className="grow">{t('search')}<input value={q} onChange={e => setQ(e.target.value)} /></label>
      <label>{t('status')}<select value={state} onChange={e => setState(e.target.value)}><option value="">{t('allStates')}</option>
        {states.map(s => <option key={s} value={s}>{t(`state.${s}` as AdminKey)}</option>)}</select></label>
      <button className="primary">{t('search').split(' ')[0]}</button>
    </form>
    {error ? <p className="error">{error}</p> : null}
    <div className="table-scroll"><table>
      <thead><tr><th>{t('shop')}</th><th>{t('owner')}</th><th>{t('status')}</th><th>{t('plan')}</th><th className="num">{t('technicians')}</th><th>{t('periodEnd')}</th><th>{t('created')}</th></tr></thead>
      <tbody>{rows?.length ? rows.map(r => <tr key={r.id} className="click" onClick={() => onOpen(r.id)}>
        <td><button className="link">{r.name}</button></td><td>{r.owner_name ?? '—'}<div className="muted">{r.owner_phone}</div></td><td><Pill group="state" value={r.state} /></td>
        <td>{r.plan_code ?? '—'}</td><td className="num">{r.active_technicians}</td><td>{dateOnly(r.period_end, lang)}</td><td>{dateOnly(r.created_at, lang)}</td>
      </tr>) : <tr><td colSpan={7} className="muted">{rows ? t('empty') : '…'}</td></tr>}</tbody>
    </table></div>
    <Pager offset={offset} hasMore={hasMore} busy={!rows} onChange={at => load(undefined, at)} />
  </section>;
}

interface ShopDetail {
  organization: { id: string; name: string; status: string; timezone: string; created_at: string; suspension_kind?: 'temporary' | 'permanent' | null; suspended_until?: string | null };
  entitlement: { state: string; plan_code: string | null; technician_seats: number; storage_bytes: number; ocr_per_period: number; period_end: string | null };
  usage: { active_technicians: number; storage_bytes: number; ocr: number };
  team: { name: string; role: string; status: string; phone: string | null; joined_at: string }[];
  periods: { source: string; plan: string; start_at: string; end_at: string }[];
  grants: { id: string; kind: string; reason: string; valid_until: string; entitlements: Record<string, number>; granted_by: string; ended_at: string | null }[];
  invoices: { id: string; number: string; amount_minor: number; status: string; created_at: string }[];
  platform_history: { action: string; actor: string | null; reason: string | null; created_at: string }[];
}

export function ShopView({ id, me, onBack }: { id: string; me: Me; onBack: () => void }) {
  const t = useText(), code = useCode(), ask = useAsk();
  const lang = useLanguage();
  const stepUp = useStepUp();
  const [d, setD] = useState<ShopDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [grant, setGrant] = useState({ kind: 'pilot', reason: '', until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), seats: '', storage: '' });
  const [busy, setBusy] = useState(false);
  const load = () => call<ShopDetail>('GET', `/platform/shops/${id}`).then(setD, e => setError(message(e)));
  useEffect(() => { void load(); }, [id]);
  const can = (p: string) => me.permissions.includes(p);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null); setNotice(null);
    try { await stepUp(action); setNotice(t('saved')); await load(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  if (!d) return <section><button className="ghost" onClick={onBack}>← {t('back')}</button>{error ? <p className="error">{error}</p> : <p>…</p>}</section>;
  const e = d.entitlement;
  const suspended = d.organization.status === 'suspended';
  return <section>
    <button className="ghost" onClick={onBack}>← {t('back')}</button>
    <h1>{d.organization.name} <Pill group="state" value={e.state} /></h1>
    {suspended ? <p className="error">{d.organization.suspension_kind === 'permanent' ? t('suspendedPermanent') : t('suspendedTemporary', { date: dateOnly(d.organization.suspended_until ?? null, lang) })}</p> : null}
    <p className="muted">{t('noContent')}</p>
    {notice ? <p className="ok-box">{notice}</p> : null}
    {error ? <p className="error">{error}</p> : null}
    <div className="grid2">
      <div className="panel">
        <h2>{t('shopInfo')}</h2>
        <dl><dt>ID</dt><dd><code>{d.organization.id}</code></dd><dt>{t('timezone')}</dt><dd>{d.organization.timezone}</dd>
          <dt>{t('created')}</dt><dd>{dateTime(d.organization.created_at, lang)}</dd><dt>{t('plan')}</dt><dd>{e.plan_code ?? '—'} · {t('periodEnd')} {dateOnly(e.period_end, lang)}</dd></dl>
        <h3>{t('usage')}</h3>
        <dl><dt>{t('technicians')}</dt><dd>{d.usage.active_technicians} / {e.technician_seats}</dd><dt>{t('storage')}</dt><dd>{gb(d.usage.storage_bytes)} / {gb(e.storage_bytes)}</dd>
          <dt>{t('ocr')}</dt><dd>{d.usage.ocr}</dd></dl>
      </div>
      <div className="panel">
        <h2>{t('team')}</h2>
        <ul className="plain">{d.team.map((m, i) => <li key={i}><strong>{m.name}</strong> · {code('shopRole', m.role)} · {code('member', m.status)} <span className="muted">{m.phone}</span></li>)}</ul>
        {can('shops.suspend') ? <form className="sub" onSubmit={ev => { ev.preventDefault(); void run(() => call('POST', `/platform/shops/${id}/${suspended ? 'restore' : 'suspend'}`, { reason })).then(() => setReason('')); }}>
          <h3>{suspended ? t('restore') : t('suspend')}</h3><p className="muted">{t('suspendHint')}</p>
          <label>{t('reason')}<input required maxLength={500} value={reason} onChange={ev => setReason(ev.target.value)} /></label>
          <button className={suspended ? 'primary' : 'danger'} disabled={busy}>{suspended ? t('restore') : t('suspend')}</button>
        </form> : null}
      </div>
    </div>
    <div className="panel">
      <h2>{t('grants')}</h2>
      {d.grants.length ? <div className="table-scroll"><table><thead><tr><th>{t('kind')}</th><th>{t('reason')}</th><th>{t('validUntil')}</th><th /></tr></thead><tbody>{d.grants.map(g => <tr key={g.id}>
        <td>{t(`kind.${g.kind}` as AdminKey)}<div className="muted">{Object.entries(g.entitlements).map(([k, v]) => `${code('ent', k)}: ${k === 'storage_bytes' ? gb(v) : v}`).join(', ')}</div></td>
        <td>{g.reason}<div className="muted">{g.granted_by}</div></td><td>{g.ended_at ? t('ended') : dateTime(g.valid_until, lang)}</td>
        <td>{!g.ended_at && new Date(g.valid_until) > new Date() && can('grants.manage') ? <button className="ghost small" disabled={busy}
          onClick={async () => { const r = await ask({ title: t('endGrant'), input: { label: t('reason'), required: true }, danger: true }); if (r) void run(() => call('POST', `/platform/grants/${g.id}/end`, { reason: r })); }}>{t('endGrant')}</button> : null}</td>
      </tr>)}</tbody></table></div> : <p className="muted">{t('empty')}</p>}
      {can('grants.manage') ? <form className="inline" onSubmit={ev => { ev.preventDefault(); void run(() => call('POST', `/platform/shops/${id}/grants`, { kind: grant.kind, reason: grant.reason,
        valid_until: new Date(`${grant.until}T23:59:59+07:00`).toISOString(), entitlements: { technician_seats: grant.seats ? Number(grant.seats) : undefined,
          storage_bytes: grant.storage ? Math.round(Number(grant.storage) * 1e9) : undefined } })); }}>
        <label>{t('kind')}<select value={grant.kind} onChange={ev => setGrant({ ...grant, kind: ev.target.value })}>{['pilot', 'compensation', 'temporary_upgrade'].map(k => <option key={k} value={k}>{t(`kind.${k}` as AdminKey)}</option>)}</select></label>
        <label>{t('seats')}<input inputMode="numeric" value={grant.seats} onChange={ev => setGrant({ ...grant, seats: ev.target.value.replace(/\D/g, '') })} /></label>
        <label>{t('storageGb')}<input inputMode="decimal" value={grant.storage} onChange={ev => setGrant({ ...grant, storage: ev.target.value })} /></label>
        <label>{t('validUntil')}<input type="date" required value={grant.until} onChange={ev => setGrant({ ...grant, until: ev.target.value })} /></label>
        <label className="grow">{t('reason')}<input required maxLength={500} value={grant.reason} onChange={ev => setGrant({ ...grant, reason: ev.target.value })} /></label>
        <button className="primary" disabled={busy}>{t('newGrant')}</button>
      </form> : null}
    </div>
    <div className="grid2">
      <div className="panel"><h2>{t('periods')}</h2><ul className="plain">{d.periods.map((p, i) => <li key={i}>{code('period', p.source)} · {p.plan} · {dateOnly(p.start_at, lang)} – {dateOnly(p.end_at, lang)}</li>)}</ul>
        <h3>{t('invoices')}</h3><ul className="plain">{d.invoices.map(i => <li key={i.id}>{i.number} · {money(i.amount_minor, lang)} · {code('invoice', i.status)}</li>)}</ul></div>
      <div className="panel"><h2>{t('history')}</h2><ul className="plain">{d.platform_history.map((h, i) => <li key={i}><code>{h.action}</code> · {h.actor ?? '—'} · {dateTime(h.created_at, lang)}
        {h.reason ? <div className="muted">{h.reason}</div> : null}</li>)}</ul></div>
    </div>
  </section>;
}

interface TicketRow { id: string; organization_name: string; subject: string; status: string; assigned_to: string | null; last_message_at: string; last_from_shop: boolean }
interface TicketDetail {
  ticket: { id: string; organization_id: string; organization_name: string; subject: string; status: string; opened_by: string; created_at: string };
  messages: { id: string; body: string; internal: boolean; created_at: string; author: string; from_platform: boolean }[];
  access: { id: string; status: string; scope: string[]; reason: string; duration_minutes: number; requested_by: string; account_id: string; consented: boolean; approved_by: string | null; valid_until: string | null }[];
}

export function TicketsView({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useText();
  const lang = useLanguage();
  const [filter, setFilter] = useState<'open' | 'resolved' | 'closed' | 'all'>('open');
  const [shop, setShop] = useState<string | null>(null);
  const [rows, setRows] = useState<TicketRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setRows(null); call<{ items: TicketRow[] }>('GET', `/platform/tickets?status=${filter}${shop ? `&organization_id=${shop}` : ''}`).then(r => setRows(r.items), e => setError(message(e))); }, [filter, shop]);
  return <section>
    <h1>{t('navSupport')}</h1>
    <ShopFilter value={shop} onChange={setShop} />
    <div className="tabs">{(['open', 'resolved', 'closed', 'all'] as const).map(f => <button key={f} className={filter === f ? 'tab on' : 'tab'} onClick={() => setFilter(f)}>{f === 'all' ? t('filterAll') : t(`filter.${f}` as AdminKey)}</button>)}</div>
    {error ? <p className="error">{error}</p> : null}
    <div className="table-scroll"><table>
      <thead><tr><th>{t('subject')}</th><th>{t('shop')}</th><th>{t('status')}</th><th>{t('assigned')}</th><th>{t('lastMessage')}</th></tr></thead>
      <tbody>{rows?.length ? rows.map(r => <tr key={r.id} className="click" onClick={() => onOpen(r.id)}>
        <td><button className="link">{r.subject}</button>{r.last_from_shop && r.status !== 'closed' ? <span className="pill warn" style={{ marginLeft: 8 }}>{t('waitingUs')}</span> : null}</td>
        <td>{r.organization_name}</td><td><Pill group="ticket" value={r.status} /></td><td>{r.assigned_to ?? '—'}</td><td>{dateTime(r.last_message_at, lang)}</td>
      </tr>) : <tr><td colSpan={5} className="muted">{rows ? t('empty') : '…'}</td></tr>}</tbody>
    </table></div>
  </section>;
}

export function TicketView({ id, me, onBack }: { id: string; me: Me; onBack: () => void }) {
  const t = useText();
  const lang = useLanguage();
  const [d, setD] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [request, setRequest] = useState<{ scope: string[]; minutes: number; reason: string }>({ scope: ['equipment'], minutes: 30, reason: '' });
  const [reading, setReading] = useState<{ grant: string; what: string; rows: Record<string, unknown>[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => call<TicketDetail>('GET', `/platform/tickets/${id}`).then(setD, e => setError(message(e)));
  useEffect(() => { void load(); }, [id]);
  const can = (p: string) => me.permissions.includes(p);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await action(); await load(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function read(grant: string, what: string) {
    setError(null);
    try { const r = await call<{ rows: Record<string, unknown>[] }>('GET', `/platform/access/${grant}/read/${what}`); setReading({ grant, what, rows: r.rows }); }
    catch (e) { setError(message(e)); setReading(null); }
  }
  if (!d) return <section><button className="ghost" onClick={onBack}>← {t('back')}</button>{error ? <p className="error">{error}</p> : <p>…</p>}</section>;
  return <section>
    <button className="ghost" onClick={onBack}>← {t('back')}</button>
    <h1>{d.ticket.subject} <Pill group="ticket" value={d.ticket.status} /></h1>
    <p className="lead">{d.ticket.organization_name} · {d.ticket.opened_by} · {dateTime(d.ticket.created_at, lang)}</p>
    {error ? <p className="error">{error}</p> : null}
    <div className="grid2">
      <div className="panel">
        <div className="thread">{d.messages.map(m => <div key={m.id} className={m.internal ? 'msg internal' : m.from_platform ? 'msg team' : 'msg shop'}>
          <div className="muted">{m.author}{m.internal ? ` · ${t('internalNote')}` : ''} · {dateTime(m.created_at, lang)}</div><div>{m.body}</div></div>)}</div>
        {can('support.manage') ? <>
          <label>{t('message')}<textarea rows={4} value={text} maxLength={4000} onChange={e => setText(e.target.value)} /></label>
          <div className="actions">
            <button className="primary" disabled={busy || !text.trim()} onClick={() => run(async () => { await call('POST', `/platform/tickets/${id}`, { body: text }); setText(''); })}>{t('sendReply')}</button>
            <button className="ghost" disabled={busy || !text.trim()} onClick={() => run(async () => { await call('POST', `/platform/tickets/${id}`, { body: text, internal: true }); setText(''); })}>{t('addNote')}</button>
            <button className="ghost" disabled={busy} onClick={() => run(() => call('POST', `/platform/tickets/${id}`, { assign_to_me: true }))}>{t('assignMe')}</button>
            <select aria-label={t('setStatus')} value="" onChange={e => { const status = e.target.value; if (status) void run(() => call('POST', `/platform/tickets/${id}`, { status })); }}>
              <option value="">{t('setStatus')}</option>{['open', 'in_progress', 'resolved', 'closed'].map(s => <option key={s} value={s}>{t(`ticket.${s}` as AdminKey)}</option>)}
            </select>
          </div>
        </> : null}
      </div>
      <div className="panel">
        <h2>{t('requestAccess')}</h2>
        <p className="muted">{t('accessRule')}</p>
        <ul className="plain">{d.access.map(a => <li key={a.id}>
          <Pill group="access" value={a.status} /> {a.scope.map(s => t(`scope.${s}` as AdminKey)).join(', ')} · {a.duration_minutes} {t('minutes')}
          <div className="muted">{a.requested_by} · {a.consented ? t('ownerConsented') : t('ownerNotYet')}{a.approved_by ? ` · ${a.approved_by}` : ''}{a.valid_until ? ` · ${t('until', { time: dateTime(a.valid_until, lang) })}` : ''}</div>
          {a.status === 'active' && a.account_id === me.id ? <div className="actions">{a.scope.map(s => <button key={s} className="ghost small" onClick={() => read(a.id, s)}>{t('view')}: {t(`scope.${s}` as AdminKey)}</button>)}</div> : null}
        </li>)}</ul>
        {can('access.request') && d.ticket.status !== 'closed' ? <form className="sub" onSubmit={e => { e.preventDefault(); void run(async () => { await call('POST', `/platform/tickets/${id}/access`, request); setRequest({ ...request, reason: '' }); }); }}>
          <fieldset className="checks"><legend>{t('scope')}</legend>{scopes.map(s => <label key={s} className="check"><input type="checkbox" checked={request.scope.includes(s)}
            onChange={e => setRequest({ ...request, scope: e.target.checked ? [...request.scope, s] : request.scope.filter(x => x !== s) })} />{t(`scope.${s}` as AdminKey)}</label>)}</fieldset>
          <label>{t('minutes')}<input type="number" min={5} max={60} value={request.minutes} onChange={e => setRequest({ ...request, minutes: Number(e.target.value) })} /></label>
          <label>{t('reason')}<input required maxLength={500} value={request.reason} onChange={e => setRequest({ ...request, reason: e.target.value })} /></label>
          <button className="primary" disabled={busy || !request.scope.length}>{t('requestAccess')}</button>
        </form> : null}
      </div>
    </div>
    {reading ? <div className="panel"><h2>{t(`scope.${reading.what}` as AdminKey)}</h2>
      {reading.rows.length ? <div className="table-scroll"><table><thead><tr>{Object.keys(reading.rows[0]!).filter(k => k !== 'id').map(k => <th key={k}>{k}</th>)}</tr></thead>
        <tbody>{reading.rows.map((r, i) => <tr key={i}>{Object.entries(r).filter(([k]) => k !== 'id').map(([k, v]) => <td key={k}>{typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '—')}</td>)}</tr>)}</tbody></table></div>
        : <p className="muted">{t('empty')}</p>}</div> : null}
  </section>;
}

interface AccessRow { id: string; organization_name: string; ticket_id: string; subject: string; requested_by: string; account_id: string; scope: string[]; reason: string; duration_minutes: number; consented: boolean; created_at: string }

export function AccessView({ me }: { me: Me }) {
  const t = useText(), ask = useAsk();
  const lang = useLanguage();
  const stepUp = useStepUp();
  const [rows, setRows] = useState<AccessRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => call<{ items: AccessRow[] }>('GET', '/platform/access').then(r => setRows(r.items), e => setError(message(e)));
  useEffect(() => { void load(); }, []);
  async function decide(id: string, approve: boolean) {
    setError(null);
    const reason = approve ? undefined : await ask({ title: t('reject'), input: { label: t('reason'), required: true }, danger: true }) ?? undefined;
    if (!approve && !reason) return;
    try { await stepUp(() => call('POST', `/platform/access/${id}/${approve ? 'approve' : 'reject'}`, { reason })); await load(); } catch (e) { setError(message(e)); }
  }
  return <section>
    <h1>{t('navAccess')}</h1>
    <p className="muted">{t('accessRule')}</p>
    {error ? <p className="error">{error}</p> : null}
    <div className="table-scroll"><table>
      <thead><tr><th>{t('shop')}</th><th>{t('subject')}</th><th>{t('scope')}</th><th>{t('reason')}</th><th>{t('requestedBy2')}</th><th /></tr></thead>
      <tbody>{rows?.length ? rows.map(r => <tr key={r.id}>
        <td>{r.organization_name}</td><td>{r.subject}</td><td>{r.scope.map(s => t(`scope.${s}` as AdminKey)).join(', ')} · {r.duration_minutes} {t('minutes')}</td>
        <td>{r.reason}<div className="muted">{r.consented ? t('ownerConsented') : t('ownerNotYet')}</div></td><td>{r.requested_by}<div className="muted">{dateTime(r.created_at, lang)}</div></td>
        <td className="actions">{r.account_id !== me.id || isSuperAdmin(me) ? <>
          <button className="primary small" disabled={!r.consented} onClick={() => decide(r.id, true)}>{t('approve')}</button>
          <button className="danger small" onClick={() => decide(r.id, false)}>{t('reject')}</button></> : null}</td>
      </tr>) : <tr><td colSpan={6} className="muted">{rows ? t('empty') : '…'}</td></tr>}</tbody>
    </table></div>
  </section>;
}

interface AuditRow { id: string; created_at: string; actor: string | null; organization_name: string | null; permission: string | null; action: string; target_type: string | null; reason: string | null; details: Record<string, unknown> }

export function AuditView() {
  const t = useText();
  const lang = useLanguage();
  const [action, setAction] = useState('');
  const [shop, setShop] = useState<string | null>(null);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = (before?: string, append = false) => call<{ items: AuditRow[] }>('GET', `/platform/audit?action=${encodeURIComponent(action)}${shop ? `&organization_id=${shop}` : ''}${before ? `&before=${encodeURIComponent(before)}` : ''}`)
    .then(r => setRows(prev => append && prev ? [...prev, ...r.items] : r.items), e => setError(message(e)));
  useEffect(() => { setRows(null); void load(); }, [shop]);
  return <section>
    <h1>{t('navAudit')}</h1>
    <ShopFilter value={shop} onChange={setShop} />
    <form className="inline" onSubmit={e => { e.preventDefault(); setRows(null); void load(); }}>
      <label className="grow">{t('filterAction')}<input value={action} onChange={e => setAction(e.target.value)} /></label><button className="primary">OK</button>
    </form>
    {error ? <p className="error">{error}</p> : null}
    <div className="table-scroll"><table>
      <thead><tr><th>{t('when')}</th><th>{t('actor')}</th><th>{t('action')}</th><th>{t('shop')}</th><th>{t('reason')}</th></tr></thead>
      <tbody>{rows?.length ? rows.map(r => <tr key={r.id}><td>{dateTime(r.created_at, lang)}</td><td>{r.actor ?? '—'}<div className="muted">{r.permission}</div></td>
        <td><code>{r.action}</code><div className="muted">{Object.keys(r.details ?? {}).length ? JSON.stringify(r.details) : ''}</div></td><td>{r.organization_name ?? '—'}</td><td>{r.reason ?? ''}</td></tr>)
        : <tr><td colSpan={5} className="muted">{rows ? t('empty') : '…'}</td></tr>}</tbody>
    </table></div>
    {rows && rows.length >= 200 ? <button className="ghost" onClick={() => load(rows.at(-1)!.created_at, true)}>{t('older')}</button> : null}
  </section>;
}

export function SystemView() {
  const t = useText(), code = useCode();
  const lang = useLanguage();
  const [d, setD] = useState<{ database_time: string; ocr: Record<string, number> | null; ocr_oldest_queued: string | null; deliveries: Record<string, number> | null;
    uploads_pending: number; reservations_open: number; last_scan: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { call<typeof d>('GET', '/platform/system').then(setD, e => setError(message(e))); }, []);
  return <section>
    <h1>{t('navSystem')}</h1>
    {error ? <p className="error">{error}</p> : null}
    {d ? <div className="grid2">
      <div className="panel"><h2>{t('ocrTitle')}</h2><dl>{Object.entries(d.ocr ?? {}).map(([k, v]) => <Fragment key={k}><dt>{code('ocr', k)}</dt><dd>{v}</dd></Fragment>)}<dt>{t('oldestQueued')}</dt><dd>{dateTime(d.ocr_oldest_queued, lang)}</dd></dl></div>
      <div className="panel"><h2>{t('pushTitle')}</h2><dl>{Object.entries(d.deliveries ?? {}).map(([k, v]) => <Fragment key={k}><dt>{code('delivery', k)}</dt><dd>{v}</dd></Fragment>)}</dl></div>
      <div className="panel"><dl><dt>{t('dbTime')}</dt><dd>{dateTime(d.database_time, lang)}</dd><dt>{t('uploadsStuck')}</dt><dd>{d.uploads_pending}</dd>
        <dt>{t('reservationsOpen')}</dt><dd>{d.reservations_open}</dd><dt>{t('lastScan')}</dt><dd>{dateTime(d.last_scan, lang)}</dd></dl></div>
    </div> : null}
  </section>;
}

interface DataRow { id: string; organization_name: string; request_type: string; status: string; reason: string | null; requested_by: string; created_at: string; decision_note: string | null }
const nextSteps: Record<string, string[]> = { pending: ['approved', 'rejected'], approved: ['running', 'cancelled'], running: ['succeeded', 'cancelled'] };

export function DataRequestsView() {
  const t = useText(), ask = useAsk();
  const lang = useLanguage();
  const [rows, setRows] = useState<DataRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => call<{ items: DataRow[] }>('GET', '/platform/data-requests').then(r => setRows(r.items), e => setError(message(e)));
  useEffect(() => { void load(); }, []);
  async function step(id: string, status: string) {
    const note = await ask({ title: t(`data.${status}` as AdminKey), input: { label: t('note'), required: status === 'rejected' }, danger: status === 'rejected' || status === 'cancelled' });
    if (note === null) return;
    setError(null);
    try { await call('POST', `/platform/data-requests/${id}`, { status, note: note || undefined }); await load(); } catch (e) { setError(message(e)); }
  }
  return <section>
    <h1>{t('navData')}</h1>
    <p className="muted">{t('dataRule')}</p>
    {error ? <p className="error">{error}</p> : null}
    <div className="table-scroll"><table>
      <thead><tr><th>{t('shop')}</th><th>{t('type')}</th><th>{t('status')}</th><th>{t('requested')}</th><th>{t('note')}</th><th /></tr></thead>
      <tbody>{rows?.length ? rows.map(r => <tr key={r.id}><td>{r.organization_name}</td><td>{t(`dataType.${r.request_type}` as AdminKey)}</td><td><Pill group="data" value={r.status} /></td>
        <td>{r.requested_by}<div className="muted">{dateTime(r.created_at, lang)}</div></td><td>{r.reason}<div className="muted">{r.decision_note}</div></td>
        <td className="actions">{(nextSteps[r.status] ?? []).map(s => <button key={s} className={s === 'rejected' || s === 'cancelled' ? 'danger small' : 'primary small'} onClick={() => step(r.id, s)}>{t(`data.${s}` as AdminKey)}</button>)}</td>
      </tr>) : <tr><td colSpan={6} className="muted">{rows ? t('empty') : '…'}</td></tr>}</tbody>
    </table></div>
  </section>;
}
