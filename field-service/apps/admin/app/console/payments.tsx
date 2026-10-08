'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { translate, type TranslationKey, type AdminKey } from '@field-service/i18n';
import { ShopFilter } from './shop-picker';
import { call, ConsoleError, dateOnly, dateTime, download, isSuperAdmin, money, useAsk, useLanguage, useStepUp, useText, type Me } from './api';
import { Pager, type Page } from './admin';

interface QueueRow { invoice_id: string; number: string; organization_name: string; amount_minor: string; status: string; plan_name_th: string; plan_name_en: string;
  created_at: string; proof_id: string | null; proof_status: string | null; proof_submitted_at: string | null; paid_at: string | null; bank_reference: string | null }
interface Detail {
  invoice: { id: string; number: string; organization_name: string; amount_minor: number; status: string; created_at: string; plan_snapshot: { name_th: string; name_en: string } };
  proofs: { id: string; status: string; reason: string | null; created_at: string; verification_code?: string }[];
  checkouts?: {id:string;method:string;status:string;reason:string|null;session_id:string|null;payment_intent:string|null}[];
  payment: { id: string; amount_minor: number; bank_reference: string; received_at: string; verified_at: string; verified_by: string; refunded_minor: number } | null;
  refunds: { id: string; amount_minor: number; status: string; reason: string; requested_by: string; requested_by_id: string; approved_by: string | null; bank_reference: string | null; created_at: string }[];
  period: { start_at: string; end_at: string } | null;
}
interface RefundRow { refund_id: string; invoice_id: string; number: string; organization_name: string; amount_minor: string; paid_minor: string; status: string; reason: string;
  requested_by: string; requested_by_name: string; created_at: string }

const message = (e: unknown) => e instanceof ConsoleError ? e.message : String(e);
const bahtToMinor = (v: string) => { const n = Number(v.replace(/,/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : NaN; };
const localNow = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

function Pill({ kind, value }: { kind: 'invoice' | 'proof' | 'refund'; value: string | null }) {
  const t = useText();
  if (!value) return <span className="pill">—</span>;
  const tone = value === 'paid' || value === 'accepted' || value === 'succeeded' ? 'ok' : value === 'rejected' || value === 'failed' || value === 'voided' ? 'bad' : value === 'approved' ? 'info' : 'warn';
  return <span className={`pill ${tone}`}>{t(`${kind}.${value}` as AdminKey)}</span>;
}

export function PaymentsView({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useText();
  const lang = useLanguage();
  const [filter, setFilter] = useState<'pending' | 'open' | 'paid' | 'all'>('pending');
  const [shop, setShop] = useState<string | null>(null);
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  useEffect(() => { setOffset(0); }, [filter, shop]);
  useEffect(() => { setRows(null); call<Page<QueueRow>>('GET', `/platform/billing/invoices?status=${filter}&offset=${offset}${shop ? `&organization_id=${shop}` : ''}`).then(r => { setRows(r.items); setHasMore(r.has_more); }, e => setError(message(e))); }, [filter, offset, shop]);
  return <section>
    <h1>{t('navPayments')}</h1>
    <ShopFilter value={shop} onChange={setShop} />
    <div className="tabs">{(['pending', 'open', 'paid', 'all'] as const).map(f =>
      <button key={f} className={filter === f ? 'tab on' : 'tab'} onClick={() => setFilter(f)}>{t(f === 'pending' ? 'filterPending' : f === 'open' ? 'filterOpen' : f === 'paid' ? 'filterPaid' : 'filterAll')}</button>)}</div>
    {error ? <p className="error">{error}</p> : null}
    <div className="table-scroll"><table>
      <thead><tr><th>{t('invoice')}</th><th>{t('shop')}</th><th>{t('plan')}</th><th className="num">{t('amount')}</th><th>{t('proof')}</th><th>{t('status')}</th><th>{t('created')}</th></tr></thead>
      <tbody>{rows?.length ? rows.map(r => <tr key={r.invoice_id} className="click" onClick={() => onOpen(r.invoice_id)}>
        <td><button className="link">{r.number}</button></td><td>{r.organization_name}</td><td>{lang === 'th' ? r.plan_name_th : r.plan_name_en}</td>
        <td className="num">{money(r.amount_minor, lang)}</td><td><Pill kind="proof" value={r.proof_status} /></td><td><Pill kind="invoice" value={r.status} /></td><td>{dateTime(r.created_at, lang)}</td>
      </tr>) : <tr><td colSpan={7} className="muted">{rows ? t('empty') : '…'}</td></tr>}</tbody>
    </table></div>
    <Pager offset={offset} hasMore={hasMore} busy={!rows} onChange={setOffset} />
  </section>;
}

export function InvoiceView({ id, me, onBack }: { id: string; me: Me; onBack: () => void }) {
  const t = useText();
  const lang = useLanguage();
  const stepUp = useStepUp();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [received, setReceived] = useState(localNow());
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => call<Detail>('GET', `/platform/billing/invoices/${id}`).then(d => { setDetail(d); setAmount(String(d.invoice.amount_minor / 100)); }, e => setError(message(e)));
  useEffect(() => { void load(); }, [id]);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image); }, [image]);
  const can = (p: string) => me.permissions.includes(p);
  const pendingProof = detail?.proofs.find(p => p.status === 'pending');

  async function run(action: () => Promise<string | void>) {
    setBusy(true); setError(null); setNotice(null);
    try { const text = await action(); if (text) setNotice(text); await load(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const confirmPayment = (event: FormEvent) => { event.preventDefault(); void run(async () => {
    const r = await stepUp(() => call<{ outcome: string; period_start: string; period_end: string }>('POST', `/platform/billing/invoices/${id}/confirm`, {
      amount_minor: bahtToMinor(amount), bank_reference: reference, received_at: new Date(received).toISOString(), proof_id: pendingProof?.id ?? null, note: note || undefined }));
    return r.outcome === 'existing' ? t('paymentExisting') : t('paymentConfirmed', { from: dateOnly(r.period_start, lang), to: dateOnly(r.period_end, lang) });
  }); };
  const rejectProof = (event: FormEvent) => { event.preventDefault(); if (!pendingProof) return; void run(async () => {
    await call('POST', `/platform/billing/proofs/${pendingProof.id}/reject`, { reason }); setReason(''); return t('saved');
  }); };
  const requestRefund = (event: FormEvent) => { event.preventDefault(); if (!detail?.payment) return; void run(async () => {
    await stepUp(() => call('POST', `/platform/billing/payments/${detail.payment!.id}/refunds`, { amount_minor: bahtToMinor(refundAmount), reason: refundReason }));
    setRefundAmount(''); setRefundReason(''); return t('saved');
  }); };

  if (!detail) return <section><button className="ghost" onClick={onBack}>← {t('back')}</button>{error ? <p className="error">{error}</p> : <p>…</p>}</section>;
  const inv = detail.invoice;
  return <section>
    <button className="ghost" onClick={onBack}>← {t('back')}</button>
    <h1>{t('invoice')} {inv.number} <Pill kind="invoice" value={inv.status} /></h1>
    <p className="lead">{inv.organization_name} · {lang === 'th' ? inv.plan_snapshot.name_th : inv.plan_snapshot.name_en} · <strong>{money(inv.amount_minor, lang)}</strong> · {dateTime(inv.created_at, lang)}</p>
    {notice ? <p className="ok-box" role="status">{notice}</p> : null}
    {error ? <p className="error" role="alert">{error}</p> : null}

    <div className="grid2">
      <div className="panel">
        <h2>{t('proof')}</h2>
        {detail.checkouts?.map(c=><p key={c.id}>{translate(lang,c.method==='card'?'stripe.card':'stripe.qr')} · {translate(lang,`stripe.${c.status}` as TranslationKey)} {c.reason?translate(lang,`stripe.${c.reason}` as TranslationKey):''}<br/><small>{c.session_id} {c.payment_intent}</small></p>)}
        {detail.proofs.length ? <ul className="plain">{detail.proofs.map(p => <li key={p.id}>
          <Pill kind="proof" value={p.status} /> {dateTime(p.created_at, lang)} {p.reason ? <span className="muted">— {p.reason}</span> : null}
          {p.verification_code ? <p className="muted">{translate(lang, `slip.${p.verification_code}` as TranslationKey)}</p> : null}
          {' '}<button className="link" onClick={() => download(`/platform/billing/proofs/${p.id}/file`).then(r => setImage(r.url), e => setError(message(e)))}>{t('showProof')}</button>
        </li>)}</ul> : <p className="muted">{t('empty')}</p>}
        {image ? <figure><img className="proof" src={image} alt={t('proofImage')} /><figcaption className="muted">{t('proofImage')}</figcaption></figure> : null}
      </div>

      <div className="panel">
        {detail.payment ? <>
          <h2>{t('payment')}</h2>
          <dl>
            <dt>{t('amount')}</dt><dd>{money(detail.payment.amount_minor, lang)}</dd>
            <dt>{t('bankReference')}</dt><dd><code>{detail.payment.bank_reference}</code></dd>
            <dt>{t('receivedAt')}</dt><dd>{dateTime(detail.payment.received_at, lang)}</dd>
            <dt>{t('status')}</dt><dd>{t('verifiedBy', { name: detail.payment.verified_by })} · {dateTime(detail.payment.verified_at, lang)}</dd>
            {detail.period ? <><dt>{t('period')}</dt><dd>{dateOnly(detail.period.start_at, lang)} – {dateOnly(detail.period.end_at, lang)}</dd></> : null}
          </dl>
        </> : inv.status === 'open' && can('billing.verify') ? <>
          <form onSubmit={confirmPayment}>
            <h2>{t('confirmPayment')}</h2>
            <p className="muted">{t('confirmHint')}</p>
            <label>{t('amountReceived')}<input inputMode="decimal" required value={amount} onChange={e => setAmount(e.target.value)} /></label>
            <label>{t('bankReference')}<input required maxLength={80} value={reference} onChange={e => setReference(e.target.value)} /></label>
            <label>{t('receivedAt')}<input type="datetime-local" required value={received} onChange={e => setReceived(e.target.value)} /></label>
            <label>{t('note')}<input maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
            <button className="primary" disabled={busy}>{t('confirmPayment')}</button>
          </form>
          {pendingProof ? <form onSubmit={rejectProof} className="sub">
            <h3>{t('rejectProof')}</h3>
            <label>{t('reason')}<input required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
            <button className="danger" disabled={busy}>{t('rejectProof')}</button>
          </form> : null}
        </> : null}
      </div>
    </div>

    {detail.payment ? <div className="panel">
      <h2>{t('refunds')}</h2>
      <p className="muted">{t('refundRule')}</p>
      {detail.refunds.length ? <div className="table-scroll"><table><thead><tr><th className="num">{t('amount')}</th><th>{t('status')}</th><th>{t('reason')}</th><th>{t('created')}</th><th /></tr></thead>
        <tbody>{detail.refunds.map(r => <tr key={r.id}><td className="num">{money(r.amount_minor, lang)}</td><td><Pill kind="refund" value={r.status} /></td>
          <td>{r.reason}<div className="muted">{t('requestedBy', { name: r.requested_by })}</div></td><td>{dateTime(r.created_at, lang)}</td>
          <td><RefundActions refund={{ id: r.id, status: r.status, requested_by: r.requested_by_id }} me={me} onDone={() => void load()} /></td></tr>)}</tbody></table></div> : null}
      {can('refund.request') ? <form onSubmit={requestRefund} className="inline">
        <label>{t('refundAmount')}<input inputMode="decimal" required value={refundAmount} onChange={e => setRefundAmount(e.target.value)} /></label>
        <label className="grow">{t('reason')}<input required maxLength={500} value={refundReason} onChange={e => setRefundReason(e.target.value)} /></label>
        <button className="primary" disabled={busy}>{t('requestRefund')}</button>
      </form> : null}
    </div> : null}
  </section>;
}

function RefundActions({ refund, me, onDone }: { refund: { id: string; status: string; requested_by: string }; me: Me; onDone: () => void }) {
  const t = useText(), ask = useAsk();
  const stepUp = useStepUp();
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  async function act(path: string, body: unknown) {
    setBusy(true); setError(null);
    try { await stepUp(() => call('POST', `/platform/billing/refunds/${refund.id}/${path}`, body)); onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const approver = me.permissions.includes('refund.approve') && (refund.requested_by !== me.id || isSuperAdmin(me));
  return <div className="actions">
    {refund.status === 'pending' && approver ? <>
      <button className="primary small" disabled={busy} onClick={() => act('approve', {})}>{t('approve')}</button>
      <button className="danger small" disabled={busy} onClick={async () => { const reason = await ask({ title: t('reject'), input: { label: t('reason'), required: true }, danger: true }); if (reason) void act('reject', { reason }); }}>{t('reject')}</button>
    </> : null}
    {refund.status === 'approved' && me.permissions.includes('refund.request') ? <>
      <input placeholder={t('bankReference')} value={reference} onChange={e => setReference(e.target.value)} />
      <button className="primary small" disabled={busy || !reference} onClick={() => act('complete', { succeeded: true, bank_reference: reference })}>{t('complete')}</button>
      <button className="ghost small" disabled={busy} onClick={() => act('complete', { succeeded: false })}>{t('failed')}</button>
    </> : null}
    {error ? <span className="error">{error}</span> : null}
  </div>;
}

export function RefundsView({ me, onOpen }: { me: Me; onOpen: (invoiceId: string) => void }) {
  const t = useText();
  const lang = useLanguage();
  const [rows, setRows] = useState<RefundRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => call<{ items: RefundRow[] }>('GET', '/platform/billing/refunds').then(r => setRows(r.items), e => setError(message(e)));
  useEffect(() => { void load(); }, []);
  return <section>
    <h1>{t('navRefunds')}</h1>
    <p className="muted">{t('refundRule')}</p>
    {error ? <p className="error">{error}</p> : null}
    <div className="table-scroll"><table>
      <thead><tr><th>{t('invoice')}</th><th>{t('shop')}</th><th className="num">{t('refundAmount')}</th><th>{t('status')}</th><th>{t('reason')}</th><th /></tr></thead>
      <tbody>{rows?.length ? rows.map(r => <tr key={r.refund_id}>
        <td><button className="link" onClick={() => onOpen(r.invoice_id)}>{r.number}</button></td><td>{r.organization_name}</td>
        <td className="num">{money(r.amount_minor, lang)} <span className="muted">/ {money(r.paid_minor, lang)}</span></td><td><Pill kind="refund" value={r.status} /></td>
        <td>{r.reason}<div className="muted">{t('requestedBy', { name: r.requested_by_name })} · {dateTime(r.created_at, lang)}</div></td>
        <td><RefundActions refund={{ id: r.refund_id, status: r.status, requested_by: r.requested_by }} me={me} onDone={() => void load()} /></td>
      </tr>) : <tr><td colSpan={6} className="muted">{rows ? t('empty') : '…'}</td></tr>}</tbody>
    </table></div>
  </section>;
}

interface Report { received_minor: number; refunded_minor: number; net_minor: number; payments: number; refunds: number; open_invoices: number; open_minor: number;
  pending_refunds: number; paid_shops: number; by_source: { source: string; count: number; amount_minor: number }[];
  by_plan: { plan_code: string; name_th: string; name_en: string; interval_unit: string; count: number; amount_minor: number }[];
  by_day: { day: string; received_minor: number; refunded_minor: number }[] }

function FinanceSummary({ report }: { report: Report }) {
  const t = useText();
  const lang = useLanguage();
  const tiles: [AdminKey, string, string][] = [
    ['received', money(report.received_minor, lang), `${report.payments} ${t('countLabel')}`],
    ['refunded', money(report.refunded_minor, lang), `${report.refunds} ${t('countLabel')}`],
    ['netReceived', money(report.net_minor, lang), ''],
    ['openInvoicesLabel', String(report.open_invoices), money(report.open_minor, lang)],
    ['pendingRefundsLabel', String(report.pending_refunds), ''],
    ['paidShops', String(report.paid_shops), ''],
  ];
  return <div className="panel">
    <h2>{t('financeSummary')}</h2>
    <div className="tiles small">{tiles.map(([key, value, sub]) => <div key={key} className="tile plain"><strong>{value}</strong><span>{t(key)}{sub ? <small className="muted"> · {sub}</small> : null}</span></div>)}</div>
    <div className="grid2">
      <div><h3>{t('bySource')}</h3><div className="table-scroll"><table><tbody>{report.by_source.map(s => <tr key={s.source}><td>{t(`source.${s.source}` as AdminKey)}</td><td className="num">{s.count}</td><td className="num">{money(s.amount_minor, lang)}</td></tr>)}</tbody></table></div>
        {!report.by_source.length ? <p className="muted">{t('empty')}</p> : null}</div>
      <div><h3>{t('byPlan')}</h3><div className="table-scroll"><table><tbody>{report.by_plan.map(p => <tr key={`${p.plan_code}-${p.interval_unit}`}><td>{lang === 'th' ? p.name_th : p.name_en} <span className="muted">/ {t(p.interval_unit === 'year' ? 'priceYear' : 'priceMonth')}</span></td><td className="num">{p.count}</td><td className="num">{money(p.amount_minor, lang)}</td></tr>)}</tbody></table></div>
        {!report.by_plan.length ? <p className="muted">{t('empty')}</p> : null}</div>
    </div>
    {report.by_day.length ? <><h3>{t('byDay')}</h3><div className="table-scroll"><table>
      <thead><tr><th>{t('dayLabel')}</th><th className="num">{t('received')}</th><th className="num">{t('refunded')}</th></tr></thead>
      <tbody>{report.by_day.map(d => <tr key={d.day}><td>{dateOnly(d.day, lang)}</td><td className="num">{money(d.received_minor, lang)}</td><td className="num">{money(d.refunded_minor, lang)}</td></tr>)}</tbody>
    </table></div></> : null}
  </div>;
}

export function ReconcileView() {
  const t = useText();
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  async function summary() {
    setError(null); setReport(null);
    try { setReport(await call<Report>('GET', `/platform/billing/report?from=${from}&to=${to}`)); } catch (e) { setError(message(e)); }
  }
  async function get(event: FormEvent) {
    event.preventDefault(); setError(null);
    try {
      const file = await download(`/platform/billing/reconciliation.csv?from=${from}&to=${to}`);
      const a = document.createElement('a'); a.href = file.url; a.download = `reconciliation-${from}-${to}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(file.url), 10_000);
    } catch (e) { setError(message(e)); }
  }
  return <section>
    <h1>{t('navReconcile')}</h1>
    <p className="muted">{t('reconcileHint')}</p>
    <form className="inline" onSubmit={get}>
      <label>{t('from')}<input type="date" required value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>{t('to')}<input type="date" required value={to} onChange={e => setTo(e.target.value)} /></label>
      <button type="button" onClick={() => void summary()}>{t('showSummary')}</button>
      <button className="primary">{t('download')}</button>
    </form>
    <p className="muted">{t('financeHint')}</p>
    {error ? <p className="error">{error}</p> : null}
    {report ? <FinanceSummary report={report} /> : null}
  </section>;
}
