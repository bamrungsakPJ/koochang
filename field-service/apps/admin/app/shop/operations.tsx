'use client';
import { useContext, useEffect, useRef, useState } from 'react';
import { formatDate } from '@field-service/i18n';
import { CreditCard, Landmark, QrCode } from 'lucide-react';
import { api, type Autopay, type BuyerProfile, type MaintenanceItem, type ContactResult, type TaxDocument } from './api';
import type { Go } from './OwnerApp';
import { ActionState, Button, dateTime, Empty, Field, LanguageContext, money, Note, Notice, PageTitle, Panel, ResourceState, SearchSelect, Select, statusText, toInstant, useAction, useResource, useTeamOptions, useText, uuid } from './ui';
export function MaintenanceView({ org, go }: { org: string; go: Go }) {
  const t = useText(), lang = useContext(LanguageContext), a = useAction();
  const r = useResource(() => api.maintenance(org), [org]), team = useResource(() => api.team(org), [org]), teamOptions = useTeamOptions(team.data?.members);
  const [bucket, setBucket] = useState(''), [selected, setSelected] = useState<string[]>([]), [assignee, setAssignee] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState(''), [description, setDescription] = useState('');
  const key = useRef<string | null>(null), chosen = r.data?.items.filter(i => selected.includes(i.id)) ?? [], location = chosen[0]?.location_id;
  return <><PageTitle>{t('maintenance')}</PageTitle><p className="lead muted">{t('maintenanceHint')}</p><ResourceState resource={r} /><ResourceState resource={team} /><ActionState action={a} />
    {r.data ? <><div className="tiles">{(['overdue', 'within_7', 'within_30'] as const).map((b, i) => <Button key={b} className={`tile ${i === 0 ? 'rose' : i === 1 ? 'amber' : 'teal'}`} onClick={() => setBucket(bucket === b ? '' : b)}><strong>{r.data!.counts[b]}</strong><span>{t(b === 'overdue' ? 'maintenanceOverdue' : b === 'within_7' ? 'maintenanceWithin7' : 'maintenanceWithin30')}</span></Button>)}</div>
    {chosen.length ? <Panel title={`${t('bookJob')} · ${chosen.length}`}><form onSubmit={e => { e.preventDefault(); void a.run(async () => {
      const result = await api.bookMaintenance(org, { request_key: key.current ?? (key.current = uuid()), cycle_ids: selected, assignee_member_id: assignee || null, scheduled_start: toInstant(start), scheduled_end: toInstant(end), description: description.trim() || undefined }); key.current = null; go({ section: 'job', id: result.job_id });
    }); }}><p>{chosen.map(i => i.equipment_name || statusText(lang, 'category', i.category)).join(' · ')}</p><div className="grid2"><Field label={t('ownerWeb.start_bangkok_time')} type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /><Field label={t('ownerWeb.end_bangkok_time')} type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></div><SearchSelect label={t('assignee')} selected={teamOptions.find(o => o.value === assignee) ?? null} options={teamOptions} placeholder={t('unassignedOption')} onSelect={o => setAssignee(o?.value ?? '')} /><Note label={t('jobDescription')} value={description} onChange={e => setDescription(e.target.value)} /><Button type="submit" kind="primary" busy={a.busy}>{t('bookJob')}</Button></form></Panel> : null}
    {r.data.items.filter(i => !bucket || i.bucket === bucket).map(i => <Panel key={`${i.id}:${i.version}`} title={`${i.customer_name || i.customer_phone} · ${i.location_label}`}><p><Button kind="link" onClick={() => go({ section: 'equipment', id: i.equipment_id })}>{i.equipment_name || [statusText(lang, 'category', i.category), i.brand, i.model].filter(Boolean).join(' ')}</Button> · {i.due_date}</p><p>{i.location_address}</p>{i.customer_phone ? <a href={`tel:${i.customer_phone}`}>{i.customer_phone}</a> : null}<p className="muted">{dateTime(i.last_service_at, lang)}</p>{i.last_contact ? <p>{t('lastContact', { result: statusText(lang, 'contact', i.last_contact.result) })} · {i.last_contact.note}</p> : null}
      {i.booked_job_id ? <Button onClick={() => go({ section: 'job', id: i.booked_job_id! })}>{t('openJob')}</Button> : <label className="check"><input type="checkbox" checked={selected.includes(i.id)} disabled={!!location && location !== i.location_id} onChange={e => { setSelected(e.target.checked ? [...selected, i.id] : selected.filter(id => id !== i.id)); key.current = null; }} />{t('alsoBook')}</label>}
      <MaintenanceActions org={org} item={i} onDone={async () => { setSelected([]); key.current = null; await r.reload(); }} /></Panel>)}{!r.data.items.length ? <Empty /> : null}</> : null}</>;
}
function MaintenanceActions({ org, item: i, onDone }: { org: string; item: MaintenanceItem; onDone: () => Promise<void> }) {
  const t = useText(), lang = useContext(LanguageContext), a = useAction(), [open, setOpen] = useState(false), [result, setResult] = useState<ContactResult>('no_answer'), [note, setNote] = useState(''), [next, setNext] = useState(''), [due, setDue] = useState(i.due_date), [reason, setReason] = useState('');
  return <><Button onClick={() => setOpen(!open)}>{t('logContact')} / {t('postpone')}</Button>{open ? <div className="grid2"><form onSubmit={e => { e.preventDefault(); void a.run(async () => { await api.logContact(org, i.id, { result, note: note.trim() || undefined, next_contact_on: next || null }); await onDone(); }, t('contactSaved')); }}><Select label={t('logContact')} value={result} onChange={e => setResult(e.target.value as ContactResult)}>{['no_answer', 'interested', 'call_later', 'declined', 'booked'].map(c => <option key={c} value={c}>{statusText(lang, 'contact', c)}</option>)}</Select><Note label={t('contactNote')} value={note} maxLength={2000} onChange={e => setNote(e.target.value)} /><Field label={t('nextContactOn')} type="date" value={next} onChange={e => setNext(e.target.value)} /><Button kind="primary" type="submit" busy={a.busy}>{t('save')}</Button></form>
    <form onSubmit={e => { e.preventDefault(); void a.run(async () => { await api.postponeCycle(org, i.id, { expected_version: i.version, due_date: due, reason: reason.trim() }); await onDone(); }, t('postponed')); }}><Field label={t('newDueDate')} type="date" required value={due} onChange={e => setDue(e.target.value)} /><Note label={t('reasonLabel')} required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /><div className="actions"><Button kind="primary" type="submit" busy={a.busy}>{t('postpone')}</Button><Button kind="danger" busy={a.busy} disabled={!reason.trim()} onClick={() => { if (window.confirm(t('stopReminderConfirm'))) void a.run(async () => { await api.stopCycle(org, i.id, reason.trim()); await onDone(); }, t('reminderStopped')); }}>{t('stopReminder')}</Button></div></form></div> : null}<ActionState action={a} /></>;
}
export function BillingView({ org, go }: { org: string; go: Go }) {
  const t = useText(), lang = useContext(LanguageContext), a = useAction(), keys = useRef(new Map<string, string>());
  const r = useResource(async () => { const [subscription, plans, invoices] = await Promise.all([api.subscription(org), api.billingPlans(org), api.invoices(org)]); return { subscription, plans, invoices }; }, [org]);
  return <><PageTitle>{t('subscription')}</PageTitle><ResourceState resource={r} /><ActionState action={a} />{r.data ? <>
    <Panel><h2>{r.data.subscription.plan ? lang === 'th' ? r.data.subscription.plan.name_th : r.data.subscription.plan.name_en : '—'}</h2><p>{statusText(lang, 'sub', r.data.subscription.state)} · {dateTime(r.data.subscription.period_end, lang)}</p>
      {r.data.subscription.usage && r.data.subscription.limits ? <div className="grid2"><p>{t('team')} {r.data.subscription.usage.technician_seats}/{r.data.subscription.limits.technician_seats}</p><p>{t('ownerWeb.photo_storage')} {(r.data.subscription.usage.storage_bytes / 1e9).toFixed(2)}/{(r.data.subscription.limits.storage_bytes / 1e9).toFixed(0)} GB</p></div> : null}
      {r.data.subscription.source === 'paid' ? <Button busy={a.busy} onClick={() => { if (window.confirm(t('ownerWeb.change_your_renewal_preference'))) void a.run(async () => { await api.changeRenewal(org, r.data!.subscription.cancel_at_period_end ? 'resume-renewal' : 'cancel-renewal'); await r.reload(); }); }}>{r.data.subscription.cancel_at_period_end ? t('resumeRenewal') : t('cancelRenewal')}</Button> : null}</Panel>
    <AutopayPanel org={org} />
    <p className="muted">{t('ownerWeb.pilot_plan_prices')}</p>{!r.data.plans.payment_available ? <Notice>{t('ownerWeb.payment_account_is_not_configured_contact_our_team')}</Notice> : null}<div className="plan-grid">{r.data.plans.items.map(p => <Panel key={p.price_version_id} title={lang === 'th' ? p.name_th : p.name_en}><p className="plan-price">{money(p.amount_minor, lang)} <small>{t(p.interval_unit==='year'?'ownerWeb.year':'ownerWeb.month')}</small></p>{p.renewal ? <p className="muted">{t('plan.yourPrice')}</p> : null}{p.change ? <Notice>{t('plan.changeOn', { date: dateTime(p.change.effective_at, lang), price: money(p.change.amount_minor, lang), seats: p.change.technician_seats, storage: Math.round(Number(p.change.storage_bytes) / 1e9) })}</Notice> : null}<p>{p.technician_seats ? `${t('ownerWeb.technicians')} ${p.technician_seats}` : t('ownerOnly')}</p><p>{t('ownerWeb.photo_storage')} {Number(p.storage_bytes) / 1e9} GB</p><Button kind="primary" busy={a.busy} disabled={!r.data!.plans.payment_available} onClick={() => a.run(async () => {
      if (!keys.current.has(p.price_version_id)) keys.current.set(p.price_version_id, uuid());
      const invoice = await api.createInvoice(org, p.price_version_id, keys.current.get(p.price_version_id)!); go({ section: 'invoice', id: invoice.id });
    })}>{t('ownerWeb.choose_plan_create_invoice')}</Button></Panel>)}</div>
    <Panel title={t('ownerWeb.payment_history')}><div className="table-scroll"><table><thead><tr><th>{t('ownerWeb.invoice')}</th><th>{t('ownerWeb.amount')}</th><th>{t('ownerWeb.status')}</th><th>{t('ownerWeb.proof')}</th></tr></thead><tbody>{r.data.invoices.items.map(i => <tr key={i.id}><td><Button kind="link" onClick={() => go({ section: 'invoice', id: i.id })}>{i.number}</Button></td><td>{money(i.amount_minor, lang)}</td><td>{statusText(lang, 'invoice', i.status)}</td><td>{i.proof_status ? statusText(lang, 'proof', i.proof_status) : '—'}</td></tr>)}</tbody></table></div>{!r.data.invoices.items.length ? <Empty /> : null}</Panel>
    <TaxPanel org={org} /></> : null}</>;
}
/** Receipts / tax invoices and credit notes issued in ITISME, and who they are made out to. */
function TaxPanel({ org }: { org: string }) {
  const t = useText(), lang = useContext(LanguageContext), a = useAction(), open = useAction();
  const p = useResource(() => api.buyerProfile(org), [org]), d = useResource(() => api.taxDocuments(org), [org]);
  const [form, setForm] = useState<{ buyer_name: string; tax_id: string; hq: boolean; branch_no: string; address: string; phone: string; email: string } | null>(null);
  const edit = (x: BuyerProfile | null, name: string) => setForm({ buyer_name: x?.buyer_name ?? name, tax_id: x?.tax_id ?? '', hq: !x?.branch_no || x.branch_no === '00000',
    branch_no: x?.branch_no && x.branch_no !== '00000' ? x.branch_no : '', address: x?.address ?? '', phone: x?.phone ?? '', email: x?.email ?? '' });
  const profile = p.data?.profile ?? null;
  const number = (x: TaxDocument) => x.kind === 'receipt' ? x.receipt_no : x.credit_note_no;
  function pdf(x: TaxDocument) {
    // Open the tab now (popup blockers allow it only inside the click), then point it at the short-lived link.
    const tab = window.open('', '_blank');
    void open.run(async () => { const { url } = await api.taxDocumentLink(org, x.id); if (tab) { tab.opener = null; tab.location.href = url; } else window.location.assign(url); });
  }
  return <Panel title={t('tax.title')}><p className="muted">{t('tax.hint')}</p>
    <ResourceState resource={p} /><ActionState action={a} /><ActionState action={open} />
    <h3>{t('tax.buyerTitle')}</h3>
    {form ? <form onSubmit={e => { e.preventDefault(); void a.run(async () => {
      const taxId = form.tax_id.replace(/[\s-]/g, '');
      await api.saveBuyerProfile(org, { version: profile?.version ?? 0, buyer_name: form.buyer_name.trim(), tax_id: taxId || null,
        branch_no: taxId ? (form.hq ? '00000' : form.branch_no.trim()) : null, address: form.address.trim(), phone: form.phone.trim() || null, email: form.email.trim() || null });
      await Promise.all([p.reload(), d.reload()]); setForm(null);
    }, t('tax.saved')); }}>
      <p className="muted">{t('tax.buyerHint')}</p>
      <Field label={t('tax.buyerName')} required maxLength={200} value={form.buyer_name} onChange={e => setForm({ ...form, buyer_name: e.target.value })} />
      <div className="grid2"><Field label={t('tax.taxId')} inputMode="numeric" maxLength={17} value={form.tax_id} onChange={e => setForm({ ...form, tax_id: e.target.value })} />
        {form.tax_id.trim() ? <Select label={t('tax.branch')} value={form.hq ? 'hq' : 'branch'} onChange={e => setForm({ ...form, hq: e.target.value === 'hq' })}>
          <option value="hq">{t('tax.hq')}</option><option value="branch">{t('tax.branch')}</option></Select> : null}</div>
      {form.tax_id.trim() && !form.hq ? <Field label={t('tax.branchNo')} required inputMode="numeric" pattern="\d{5}" maxLength={5} value={form.branch_no} onChange={e => setForm({ ...form, branch_no: e.target.value })} /> : null}
      <Note label={t('tax.address')} required maxLength={500} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
      <div className="grid2"><Field label={t('tax.phone')} type="tel" maxLength={30} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
        <Field label={t('tax.email')} type="email" maxLength={100} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
      <div className="actions"><Button kind="primary" type="submit" busy={a.busy}>{t('tax.save')}</Button><Button type="button" onClick={() => setForm(null)}>{t('cancel')}</Button></div>
    </form> : p.data ? <>{profile ? <p><strong>{profile.buyer_name}</strong>{profile.tax_id ? <> · {profile.tax_id} {profile.branch_no === '00000' ? t('tax.hq') : `${t('tax.branch')} ${profile.branch_no}`}</> : null}<br />{profile.address}</p>
      : <Notice>{t('tax.noProfile', { name: p.data.organization_name })}</Notice>}
      <Button onClick={() => edit(profile, p.data!.organization_name)}>{t('tax.edit')}</Button></> : null}
    <ResourceState resource={d} />
    {d.data?.items.length ? <div className="table-scroll"><table><thead><tr><th>{t('tax.number')}</th><th>{t('tax.date')}</th><th>{t('ownerWeb.amount')}</th><th>{t('ownerWeb.status')}</th><th /></tr></thead>
      <tbody>{d.data.items.map(x => <tr key={x.id}><td>{t(`tax.kind.${x.kind}`)}<div className="muted">{number(x) ?? '—'}</div></td><td>{formatDate(new Date(x.doc_date), lang)}</td>
        <td>{money(x.gross_minor, lang)}</td><td>{t(`tax.status.${x.status}`)}</td>
        <td>{x.status === 'issued' ? <Button busy={open.busy} onClick={() => pdf(x)}>{t('tax.open')}</Button> : null}</td></tr>)}</tbody></table></div>
      : d.data ? <p className="muted">{t('tax.empty')}</p> : null}
  </Panel>;
}
/** Automatic renewal through Stripe Subscription. Stripe keeps the card; owners change it in Stripe's portal. */
function AutopayPanel({ org }: { org: string }) {
  const t = useText(), lang = useContext(LanguageContext), a = useAction(), r = useResource(() => api.autopay(org), [org]);
  const [state, setState] = useState<Autopay | null>(null), d = state ?? r.data;
  if (!d || (!d.available && !d.subscription)) return null;
  const sub = d.subscription, live = Boolean(sub?.live), date = dateTime(sub?.current_period_end ?? null, lang);
  return <Panel title={t('autopay.title')}><p>{live ? t(sub!.cancel_at_period_end ? 'autopay.onStopping' : 'autopay.on', { date })
    : sub?.canceled_by_owner ? t('autopay.ownerStopped') : sub ? t('autopay.stopped') : t('autopay.off')}</p>
    {live && ['past_due', 'unpaid', 'incomplete'].includes(sub!.status) ? <Notice error>{t('autopay.pastDue')}</Notice> : null}
    <ActionState action={a} />
    <div className="actions">{sub ? <Button busy={a.busy} onClick={() => a.run(async () => { window.location.assign((await api.autopayPortal(org)).url); })}>{t('autopay.manage')}</Button> : null}
    {live ? <Button kind="danger" busy={a.busy} onClick={() => { if (window.confirm(t('autopay.cancelConfirm'))) void a.run(async () => setState(await api.cancelAutopay(org))); }}>{t('autopay.cancel')}</Button> : null}</div></Panel>;
}
type PayMethod = 'qr' | 'transfer' | 'card';
const payIcons = { qr: QrCode, transfer: Landmark, card: CreditCard };
export function InvoiceView({ org, id, go }: { org: string; id: string; go: Go }) {
  const t = useText(), lang = useContext(LanguageContext), a = useAction(), r = useResource(() => api.invoice(org, id), [org, id]);
  const [file, setFile] = useState<File | null>(null), proofId = useRef<string | null>(null), i = r.data;
  const checkoutKeys = useRef<Record<string,string>>({}), active = i?.checkouts?.find(c => ['creating','open'].includes(c.status));
  const [subscribe, setSubscribe] = useState(false), autopay = useResource(() => api.autopay(org), [org, i?.status]), autopayLive = Boolean(autopay.data?.subscription?.live);
  useEffect(() => { if (active?.method === 'card') setSubscribe(active.mode === 'subscription'); }, [active?.id]);
  useEffect(() => {
    if (!active || active.status !== 'open') return;
    let checking = false;
    const poll = async () => { if (checking) return; checking = true; try { await api.refreshCheckout(org,id,active.id); await r.reload(); } catch { /* Retry or explicit status check. */ } finally { checking = false; } };
    void poll(); const timer = setInterval(() => void poll(), 10_000); return () => clearInterval(timer);
  }, [org,id,active?.id,active?.status]);
  const startCheckout = (method:'card'|'promptpay') => a.run(async () => {
    if (!active && i?.checkouts?.some(c=>c.method===method&&['expired','failed'].includes(c.status))) { delete checkoutKeys.current[method]; delete checkoutKeys.current['card:subscribe']; }
    // One key per method and choice: a subscription is a different checkout.
    const sub = method === 'card' && subscribe, slot = sub ? 'card:subscribe' : method;
    checkoutKeys.current[slot] ??= uuid();
    try {
      const result = await api.stripeCheckout(org,id,method,checkoutKeys.current[slot],sub);
      await r.reload(); window.location.assign(result.url);
    } catch (error) { await r.reload().catch(() => {}); throw error; }
  });
  const [method, setMethod] = useState<PayMethod | null>(null);
  const options: PayMethod[] = i && i.status === 'open' && !autopayLive
    ? [i.pay_to?.promptpay_qr_png ? 'qr' : null, i.pay_to ? 'transfer' : null, i.methods?.stripe_card || active ? 'card' : null].filter((m): m is PayMethod => !!m) : [];
  // A checkout in progress keeps the card view (it also shows an older Stripe PromptPay checkout's status).
  const chosen = active && options.includes('card') ? 'card' : method && options.includes(method) ? method : options[0] ?? null;
  return <><Button onClick={() => go({ section: 'billing' })}>← {t('subscription')}</Button><ResourceState resource={r} /><ActionState action={a} />{i ? <><PageTitle action={<Button onClick={() => window.print()}>{t('ownerWeb.print_invoice')}</Button>}>{i.number}</PageTitle><Panel title={lang === 'th' ? i.plan_name_th : i.plan_name_en}><p className="plan-price">{money(i.amount_minor, lang)}</p><p>{statusText(lang, 'invoice', i.status)} · {dateTime(i.created_at, lang)}</p>{i.period ? <p>{dateTime(i.period.start_at, lang)} → {dateTime(i.period.end_at, lang)}</p> : null}
    </Panel>
    {i.status === 'open' && autopayLive ? <Notice>{t('autopay.blocked')}</Notice> : null}
    {chosen ? <Panel title={t('stripe.title')}>
      {/* Only methods that are set up are offered: own PromptPay QR, bank transfer (both checked by slip), card through Stripe. */}
      <div className="pay-methods" role="radiogroup" aria-label={t('stripe.title')}>{options.map(m => { const Icon = payIcons[m]; return <button key={m} type="button" role="radio" aria-checked={chosen === m}
        className={chosen === m ? 'pay-method on' : 'pay-method'} disabled={Boolean(active) && m !== 'card'} onClick={() => setMethod(m)}><Icon size={22} aria-hidden /><span>{t(m === 'qr' ? 'pay.qr' : m === 'transfer' ? 'pay.transfer' : 'pay.card')}</span></button>; })}</div>
      {chosen === 'qr' && i.pay_to?.promptpay_qr_png ? <div className="pay-qr"><img src={i.pay_to.promptpay_qr_png} alt={t('pay.qr')} width={240} height={240} />
        <p className="plan-price">{money(i.amount_minor, lang)}</p><p>{t('pay.payee')}: {i.pay_to.account_name}</p>
        <a href={i.pay_to.promptpay_qr_png} download={`${i.number}-promptpay.png`}>{t('pay.saveQr')}</a><p className="muted">{t('pay.qrHint')}</p></div> : null}
      {chosen === 'transfer' && i.pay_to ? <><p className="muted">{t('pay.transferHint')}</p><dl><dt>{t('ownerWeb.bank')}</dt><dd>{i.pay_to.bank_name}</dd><dt>{t('ownerWeb.account_name')}</dt><dd>{i.pay_to.account_name}</dd>
        <dt>{t('ownerWeb.account_number')}</dt><dd>{i.pay_to.account_number}</dd><dt>{t('amountDue')}</dt><dd>{money(i.amount_minor, lang)}</dd><dt>{t('ownerWeb.reference')}</dt><dd>{i.pay_to.reference}</dd></dl></> : null}
      {chosen === 'qr' || chosen === 'transfer' ? <div className="pay-slip"><h3>{t('ownerWeb.upload_transfer_proof')}</h3><Notice>{t('ownerWeb.uploading_a_slip_does_not_renew_the_plan_our')}</Notice><label>{t('choosePhoto')}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={a.busy || Boolean(active)} onChange={e => { setFile(e.target.files?.[0] ?? null); proofId.current = null; }} /></label><Button kind="primary" busy={a.busy} disabled={!file || Boolean(active) || i.proofs.some(p => p.status === 'pending')} onClick={() => a.run(async () => { await api.uploadProof(org, id, proofId.current ?? (proofId.current = uuid()), file!, file!.type); setFile(null); proofId.current = null; await r.reload(); }, t('saved'))}>{t('send')}</Button></div> : null}
      {chosen === 'card' ? <>{i.methods?.stripe_test ? <Notice>{t('stripe.test')}</Notice> : null}
        {i.methods?.stripe_card ? <><fieldset className="pay-charge"><legend>{t('pay.chargeBy')}</legend>
            <label className={!subscribe ? 'check on' : 'check'}><input type="radio" name="charge" checked={!subscribe} disabled={Boolean(active)} onChange={() => setSubscribe(false)} /><span>{t('pay.cardOnce')}</span></label>
            <label className={subscribe ? 'check on' : 'check'}><input type="radio" name="charge" checked={subscribe} disabled={Boolean(active)} onChange={() => setSubscribe(true)} /><span>{t('pay.cardAuto')}<br /><small className="muted">{t('pay.cardAutoShort')}</small></span></label></fieldset>
          <div className="actions"><Button kind="primary" busy={a.busy} disabled={Boolean(active && (active.method !== 'card' || (active.mode === 'subscription') !== subscribe)) || i.proofs.some(p=>p.status==='pending')} onClick={()=>startCheckout('card')}>{t('pay.card')}</Button></div></> : null}
        {active ? <><p>{statusText(lang,'stripe',active.status)}</p>{active.checkout_url ? <Button onClick={()=>window.location.assign(active.checkout_url!)}>{t('stripe.resume')}</Button> : null}<Button busy={a.busy} onClick={()=>a.run(async()=>{await api.refreshCheckout(org,id,active.id);await r.reload();})}>{t('stripe.refresh')}</Button>{active.status==='open' ? <Button busy={a.busy} onClick={()=>a.run(async()=>{await api.cancelCheckout(org,id,active.id);checkoutKeys.current={};await r.reload();})}>{t('stripe.cancel')}</Button> : null}</> : null}</> : null}
    </Panel> : null}
    {i.checkouts?.filter(c=>c.reason).map(c=><Notice key={c.id}>{statusText(lang,'stripe',c.reason!)}</Notice>)}
    {i.status === 'paid' ? <Notice>{t('paymentActivated')}</Notice> : null}
    <Panel title={t('ownerWeb.proof_review_status')}>{i.proofs.length ? i.proofs.map(p => <p key={p.id}>{statusText(lang, 'proof', p.status)} · {dateTime(p.created_at, lang)} · {p.reason || (p.verification_code ? statusText(lang, 'slip', p.verification_code) : '')}</p>) : <Empty />}</Panel></> : null}</>;
}
export function SupportView({ org }: { org: string }) {
  const t = useText(), lang = useContext(LanguageContext), a = useAction(), r = useResource(() => api.support(org), [org]);
  const [subject, setSubject] = useState(''), [body, setBody] = useState(''), [reply, setReply] = useState<Record<string, string>>({});
  return <><PageTitle>{t('support')}</PageTitle><p className="lead muted">{t('supportHint')}</p><ResourceState resource={r} /><ActionState action={a} />
    <Panel title={t('newTicket')}><form onSubmit={e => { e.preventDefault(); void a.run(async () => { await api.openTicket(org, subject.trim(), body.trim()); setSubject(''); setBody(''); await r.reload(); }, t('saved')); }}><Field label={t('ticketSubject')} required maxLength={200} value={subject} onChange={e => setSubject(e.target.value)} /><Note label={t('ticketBody')} required maxLength={4000} value={body} onChange={e => setBody(e.target.value)} /><Button kind="primary" type="submit" busy={a.busy}>{t('send')}</Button></form></Panel>
    {r.data ? <><Panel title={t('accessRequests')}><p>{t('accessHint')}</p>{r.data.access.filter(g => ['pending', 'active'].includes(g.status)).map(g => <article key={g.id}><h3>{g.agent} · {statusText(lang, 'access', g.status)}</h3><p>{g.reason}</p><p>{g.scope.map(s => statusText(lang, 'scope', s)).join(' · ')} · {t('minutesN', { n: g.duration_minutes })}</p><p>{dateTime(g.valid_until, lang)} · {t('readsN', { n: g.reads })}</p>
      {g.status === 'pending' && !g.consented ? <div className="actions"><Button kind="primary" busy={a.busy} onClick={() => { if (window.confirm(t('ownerWeb.consent_to_this_scope_and_duration_of_access'))) void a.run(async () => { await api.supportAccess(org, g.id, 'consent'); await r.reload(); }); }}>{t('allow')}</Button><Button busy={a.busy} onClick={() => a.run(async () => { await api.supportAccess(org, g.id, 'refuse'); await r.reload(); })}>{t('refuse')}</Button></div> : <><p>{g.status === 'pending' ? t('waitingApproval') : ''}</p><Button kind="danger" busy={a.busy} onClick={() => a.run(async () => { await api.supportAccess(org, g.id, 'revoke'); await r.reload(); })}>{t('revokeAccess')}</Button></>}</article>)}</Panel>
    <Panel title={t('yourTickets')}>{r.data.tickets.length ? r.data.tickets.map(ticket => <details key={ticket.id} className="ticket-details"><summary>{ticket.subject} · {statusText(lang, 'ticket', ticket.status)}</summary><div className="thread">{ticket.messages?.map(m => <div key={m.id} className={`msg ${m.from_platform ? 'team' : 'shop'}`}><small>{m.from_platform ? t('fromTeam') : t('fromYou')} · {dateTime(m.created_at, lang)}</small><p>{m.body}</p></div>)}</div>{ticket.status !== 'closed' ? <form onSubmit={e => { e.preventDefault(); void a.run(async () => { await api.replyTicket(org, ticket.id, (reply[ticket.id] ?? '').trim()); setReply(v => ({ ...v, [ticket.id]: '' })); await r.reload(); }); }}><Note label={t('reply')} required maxLength={4000} value={reply[ticket.id] ?? ''} onChange={e => setReply(v => ({ ...v, [ticket.id]: e.target.value }))} /><Button type="submit" busy={a.busy}>{t('send')}</Button></form> : null}</details>) : <Empty />}</Panel>
    <Panel title={t('requestExport')}>
      {r.data.data_requests.map(d => <p key={d.id}>{dateTime(d.created_at, lang)} · {statusText(lang, 'dataRequest', d.status)} · {d.note}
        {d.type==='export'&&d.status==='succeeded'?<Button busy={a.busy} onClick={()=>a.run(async()=>{
          const body=await api.exportData(org,d.id),url=URL.createObjectURL(new Blob([JSON.stringify(body,null,2)],{type:'application/json'}));
          const link=document.createElement('a');link.href=url;link.download=`shop-export-${d.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        })}>{t('ownerWeb.download_export')}</Button>:null}</p>)}
      <p className="muted">{t('ownerWeb.privacy_request_hint')}</p><div className="actions">
        {(['export','closure','deletion'] as const).map(kind=><Button key={kind} busy={a.busy} disabled={r.data!.data_requests.some(d=>d.type===kind&&['pending','approved','running'].includes(d.status))} onClick={()=>{
          if(window.confirm(t(kind==='export'?'requestExport':kind==='closure'?'ownerWeb.request_closure':'ownerWeb.request_deletion')))void a.run(async()=>{await api.requestExport(org,kind);await r.reload();},t('exportRequested'));
        }}>{t(kind==='export'?'requestExport':kind==='closure'?'ownerWeb.request_closure':'ownerWeb.request_deletion')}</Button>)}
      </div>
    </Panel></> : null}</>;
}
