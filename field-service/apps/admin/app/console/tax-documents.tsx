'use client';
import { useEffect, useState } from 'react';
import type { AdminKey } from '@field-service/i18n';
import { ShopFilter } from './shop-picker';
import { call, ConsoleError, dateOnly, dateTime, download, money, useAsk, useLanguage, useText, type Me } from './api';
import { Pager, type Page } from './admin';

interface TaxRow { id: string; organization_id: string; organization_name: string; kind: 'receipt' | 'credit_note'; ref: string; doc_date: string; gross_minor: number;
  status: 'queued' | 'running' | 'issued' | 'failed' | 'skipped'; attempts: number; last_error: string | null; invoice_no: string | null; receipt_no: string | null;
  credit_note_no: string | null; issued_at: string | null; created_at: string }
type Filter = 'open' | 'issued' | 'failed' | 'skipped' | 'all';
const message = (e: unknown) => e instanceof ConsoleError ? e.message : String(e);

/** Receipts / tax invoices and credit notes made in ITISME: what is waiting, failed or issued, the company copy PDF,
 * and retry / skip (made by hand in the legacy program) for billing.verify. */
export function TaxDocumentsView({ me }: { me: Me }) {
  const t = useText(), lang = useLanguage(), ask = useAsk();
  const [filter, setFilter] = useState<Filter>('open');
  const [shop, setShop] = useState<string | null>(null);
  const [rows, setRows] = useState<TaxRow[] | null>(null);
  const [offset, setOffset] = useState(0), [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const load = () => { setRows(null); setError(null);
    return call<Page<TaxRow>>('GET', `/platform/billing/tax-documents?status=${filter}&offset=${offset}${shop ? `&organization_id=${shop}` : ''}`)
      .then(r => { setRows(r.items); setHasMore(r.has_more); }, e => setError(message(e))); };
  useEffect(() => { setOffset(0); }, [filter, shop]);
  useEffect(() => { void load(); }, [filter, offset, shop]);
  const canAct = me.permissions.includes('billing.verify');
  async function act(row: TaxRow, action: 'retry' | 'skip') {
    const reason = await ask({ title: t(action === 'retry' ? 'taxRetryTitle' : 'taxSkipTitle'), message: t(action === 'retry' ? 'taxRetryHint' : 'taxSkipHint'),
      input: { label: t('reason'), required: true }, danger: action === 'skip' });
    if (reason === null) return;
    setBusy(true); setError(null);
    try { await call('POST', `/platform/billing/tax-documents/${row.id}/${action}`, { reason }); await load(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function pdf(row: TaxRow) {
    setError(null);
    try { const { url } = await download(`/platform/billing/tax-documents/${row.id}/pdf`); window.open(url, '_blank', 'noopener'); }
    catch (e) { setError(message(e)); }
  }
  const number = (r: TaxRow) => r.kind === 'receipt' ? [r.receipt_no, r.invoice_no].filter(Boolean).join(' / ') : r.credit_note_no;
  const tone = (s: TaxRow['status']) => s === 'issued' ? 'ok' : s === 'failed' ? 'bad' : s === 'skipped' ? '' : 'warn';
  return <section>
    <h1>{t('navTaxDocuments')}</h1>
    <p className="muted">{t('taxDocumentsHint')}</p>
    <ShopFilter value={shop} onChange={setShop} />
    <div className="tabs">{(['open', 'failed', 'issued', 'skipped', 'all'] as const).map(f =>
      <button key={f} className={filter === f ? 'tab on' : 'tab'} onClick={() => setFilter(f)}>{t(`taxFilter.${f}` as AdminKey)}</button>)}</div>
    {error ? <p className="error" role="alert">{error}</p> : null}
    <div className="table-scroll"><table>
      <thead><tr><th>{t('taxKind')}</th><th>{t('shop')}</th><th>{t('taxNumber')}</th><th>{t('taxDate')}</th><th className="num">{t('amount')}</th><th>{t('status')}</th><th /></tr></thead>
      <tbody>{rows?.length ? rows.map(r => <tr key={r.id}>
        <td>{t(`taxKind.${r.kind}` as AdminKey)}<div className="muted">{r.ref}</div></td>
        <td>{r.organization_name}</td>
        <td>{number(r) || '—'}</td>
        <td>{dateOnly(r.doc_date, lang)}{r.issued_at ? <div className="muted">{t('taxIssuedAt', { at: dateTime(r.issued_at, lang) })}</div> : null}</td>
        <td className="num">{money(r.gross_minor, lang)}</td>
        <td><span className={`pill ${tone(r.status)}`}>{t(`taxStatus.${r.status}` as AdminKey)}</span>
          {r.last_error && r.status !== 'issued' ? <div className="muted" title={r.last_error}>{t('taxAttempts', { n: r.attempts })} · {r.last_error.slice(0, 80)}</div> : null}</td>
        <td className="actions">
          {r.status === 'issued' ? <button className="ghost" onClick={() => void pdf(r)}>{t('taxOpenPdf')}</button> : null}
          {canAct && (r.status === 'failed' || r.status === 'queued') ? <>
            <button className="ghost" disabled={busy} onClick={() => void act(r, 'retry')}>{t('taxRetry')}</button>
            <button className="ghost" disabled={busy} onClick={() => void act(r, 'skip')}>{t('taxSkip')}</button></> : null}
        </td>
      </tr>) : <tr><td colSpan={7} className="muted">{rows ? t('empty') : '…'}</td></tr>}</tbody>
    </table></div>
    <Pager offset={offset} hasMore={hasMore} busy={!rows} onChange={setOffset} />
  </section>;
}
