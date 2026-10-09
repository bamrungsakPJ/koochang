import { useContext, useEffect, useRef, useState } from 'react';
import { AppState, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDate, formatMoney, type TranslationKey } from '@field-service/i18n';
import { api, ApiFailure, type Autopay, type BuyerProfile, type Invoice, type InvoiceSummary, type Membership, type PlanOffer, type TaxDocument } from '../api';
import { CameraDeniedError, pickPhoto, readPicked, uuid } from '../photos';
import { GalleryDeniedError, savePngToGallery } from '../gallery';
import { Badge, Banner, Button, Card, colors, confirm, Field, fonts, Icon, IconTile, LanguageContext, Loading, Row, Screen, Section, Strong, Sub, Title, tones, useErrorText, useT, type Tone } from '../ui';

const invoiceTone = (s: InvoiceSummary['status']) => s === 'paid' ? 'ok' : s === 'open' ? 'warn' : 'neutral';
const proofTone = (s: string | null) => s === 'accepted' ? 'ok' : s === 'rejected' ? 'danger' : 'info';
const planTone: Tone[] = ['teal', 'violet', 'amber'];
const money = (minor: string | number, language: 'th' | 'en') => formatMoney(Number(minor), language);

/** Choose a plan (BS02) and see past invoices (BS06). Creating an invoice never changes the plan. */
export function BillingScreen({ membership, onBack, onOpenInvoice }: { membership: Membership; onBack: () => void; onOpenInvoice: (id: string) => void }) {
  const t = useT();
  const language = useContext(LanguageContext);
  const errorText = useErrorText();
  const org = membership.organization_id;
  const [plans, setPlans] = useState<{ payment_available: boolean; items: PlanOffer[] } | null>(null);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keys = useRef<Record<string, string>>({});
  useEffect(() => {
    api.billingPlans(org).then(setPlans, e => setError(errorText(e)));
    api.invoices(org).then(r => setInvoices(r.items), () => {});
  }, [org]);

  async function choose(plan: PlanOffer) {
    setBusy(plan.price_version_id); setError(null);
    try {
      keys.current[plan.price_version_id] ??= uuid();
      const invoice = await api.createInvoice(org, plan.price_version_id, keys.current[plan.price_version_id]!);
      onOpenInvoice(invoice.id);
    } catch (e) {
      setError(e instanceof ApiFailure && e.code === 'SEAT_LIMIT_REACHED' ? t('planTooSmall') : e instanceof ApiFailure && e.code === 'PAYMENT_IN_PROGRESS' ? t('autopay.blocked') : errorText(e));
    } finally { setBusy(null); }
  }

  if (!plans && !error) return <Loading />;
  return <Screen onBack={onBack}>
    <Title>{t('choosePlan')}</Title>
    <Sub>{t('renewHint')}</Sub>
    {plans && !plans.payment_available ? <Banner tone="info" text={t('paymentUnavailable')} /> : null}
    <Banner text={error} />
    <AutopayCard org={org} />
    {plans?.items.map((p, i) => {
      const tone = planTone[i % planTone.length]!;
      return <Card key={p.price_version_id}>
        <View style={styles.planHead}>
          <IconTile icon={i ? 'people' : 'person'} tone={tone} size={44} />
          <View style={{ flex: 1 }}>
            <Strong>{language === 'th' ? p.name_th : p.name_en}</Strong>
            <Text style={[styles.price, { color: tones[tone][1] }]}>{money(p.amount_minor,language)} {t(p.interval_unit==='year'?'ownerWeb.year':'ownerWeb.month')}</Text>
            {p.renewal ? <Sub>{t('plan.yourPrice')}</Sub> : null}
          </View>
        </View>
        {p.change ? <Banner tone="info" text={t('plan.changeOn', { date: formatDate(new Date(p.change.effective_at), language), price: money(p.change.amount_minor, language),
          seats: p.change.technician_seats, storage: Math.round(Number(p.change.storage_bytes) / 1e9) })} /> : null}
        <Feature text={p.technician_seats ? t('seatsN', { n: p.technician_seats }) : t('ownerOnly')} />
        <Feature text={t('storageN', { n: Math.round(Number(p.storage_bytes) / 1e9) })} />
        <View style={{ marginTop: 12 }}>
          <Button title={t('choosePlan')} icon="card-outline" busy={busy === p.price_version_id} disabled={!plans.payment_available || Boolean(busy)} onPress={() => choose(p)} />
        </View>
      </Card>;
    })}
    <Sub>{t('pricesNote')}</Sub>
    <Section>{t('invoiceHistory')}</Section>
    {invoices.length ? <Card padded={false}>{invoices.map((inv, i) =>
      <Row key={inv.id} last={i === invoices.length - 1} icon="receipt" tone={inv.status === 'paid' ? 'green' : 'amber'} onPress={() => onOpenInvoice(inv.id)}
        title={`${inv.number} · ${money(inv.amount_minor, language)}`}
        subtitle={`${language === 'th' ? inv.plan_name_th : inv.plan_name_en} · ${formatDate(new Date(inv.created_at), language)}`}
        trailing={<Badge text={inv.status === 'open' && inv.proof_status ? t(`proof.${inv.proof_status}` as TranslationKey) : t(`invoice.${inv.status}` as TranslationKey)}
          tone={inv.status === 'open' && inv.proof_status ? proofTone(inv.proof_status) : invoiceTone(inv.status)} />} />)}
    </Card> : <Card><Sub center>{t('noInvoices')}</Sub></Card>}
    <TaxCard org={org} />
  </Screen>;
}

type BuyerForm = { buyer_name: string; tax_id: string; hq: boolean; branch_no: string; address: string; phone: string; email: string };
/** Receipts / tax invoices and credit notes issued in ITISME, and who they are made out to. The PDF opens in the browser
 * through a five-minute link. */
function TaxCard({ org }: { org: string }) {
  const t = useT();
  const language = useContext(LanguageContext);
  const errorText = useErrorText();
  const [profile, setProfile] = useState<{ profile: BuyerProfile | null; organization_name: string } | null>(null);
  const [docs, setDocs] = useState<TaxDocument[] | null>(null);
  const [form, setForm] = useState<BuyerForm | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null), [done, setDone] = useState<string | null>(null);
  const load = () => Promise.all([api.buyerProfile(org).then(setProfile), api.taxDocuments(org).then(r => setDocs(r.items))]).catch(e => setError(errorText(e)));
  useEffect(() => { void load(); }, [org]);
  async function run(key: string, action: () => Promise<void>) {
    setBusy(key); setError(null); setDone(null);
    try { await action(); } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  }
  const p = profile?.profile ?? null;
  const edit = () => setForm({ buyer_name: p?.buyer_name ?? profile?.organization_name ?? '', tax_id: p?.tax_id ?? '', hq: !p?.branch_no || p.branch_no === '00000',
    branch_no: p?.branch_no && p.branch_no !== '00000' ? p.branch_no : '', address: p?.address ?? '', phone: p?.phone ?? '', email: p?.email ?? '' });
  const save = (f: BuyerForm) => run('save', async () => {
    const taxId = f.tax_id.replace(/[\s-]/g, '');
    setProfile(await api.saveBuyerProfile(org, { version: p?.version ?? 0, buyer_name: f.buyer_name.trim(), tax_id: taxId || null,
      branch_no: taxId ? (f.hq ? '00000' : f.branch_no.trim()) : null, address: f.address.trim(), phone: f.phone.trim() || null, email: f.email.trim() || null }));
    setForm(null); setDone(t('tax.saved')); await load();
  });
  const set = (patch: Partial<BuyerForm>) => setForm(f => f ? { ...f, ...patch } : f);
  return <>
    <Section>{t('tax.title')}</Section>
    <Card>
      <Sub>{t('tax.hint')}</Sub>
      <Banner text={error} />{done ? <Banner tone="success" text={done} /> : null}
      <Strong>{t('tax.buyerTitle')}</Strong>
      {form ? <View style={{ gap: 8, marginTop: 8 }}>
        <Sub>{t('tax.buyerHint')}</Sub>
        <Field label={t('tax.buyerName')} required value={form.buyer_name} maxLength={200} onChangeText={v => set({ buyer_name: v })} />
        <Field label={t('tax.taxId')} value={form.tax_id} keyboardType="number-pad" maxLength={17} onChangeText={v => set({ tax_id: v })} />
        {form.tax_id.trim() ? <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button small kind={form.hq ? 'secondary' : 'ghost'} title={t('tax.hq')} onPress={() => set({ hq: true })} />
          <Button small kind={form.hq ? 'ghost' : 'secondary'} title={t('tax.branch')} onPress={() => set({ hq: false })} />
        </View> : null}
        {form.tax_id.trim() && !form.hq ? <Field label={t('tax.branchNo')} required value={form.branch_no} keyboardType="number-pad" maxLength={5} onChangeText={v => set({ branch_no: v })} /> : null}
        <Field label={t('tax.address')} required value={form.address} multiline maxLength={500} onChangeText={v => set({ address: v })} />
        <Field label={t('tax.phone')} value={form.phone} keyboardType="phone-pad" maxLength={30} onChangeText={v => set({ phone: v })} />
        <Field label={t('tax.email')} value={form.email} keyboardType="email-address" autoCapitalize="none" maxLength={100} onChangeText={v => set({ email: v })} />
        <Button title={t('tax.save')} icon="save-outline" busy={busy === 'save'} disabled={!form.buyer_name.trim() || !form.address.trim()} onPress={() => save(form)} />
        <Button small kind="ghost" title={t('cancel')} onPress={() => setForm(null)} />
      </View> : <View style={{ marginTop: 6, gap: 8 }}>
        {p ? <Sub>{[p.buyer_name, p.tax_id ? `${p.tax_id} ${p.branch_no === '00000' ? t('tax.hq') : `${t('tax.branch')} ${p.branch_no}`}` : '', p.address].filter(Boolean).join('\n')}</Sub>
          : profile ? <Banner tone="info" text={t('tax.noProfile', { name: profile.organization_name })} /> : null}
        {profile ? <Button small kind="secondary" icon="create-outline" title={t('tax.edit')} onPress={edit} /> : null}
      </View>}
    </Card>
    {docs?.length ? <Card padded={false}>{docs.map((d, i) => {
      const number = d.kind === 'receipt' ? d.receipt_no : d.credit_note_no;
      return <Row key={d.id} last={i === docs.length - 1} icon="document-text" tone={d.status === 'issued' ? 'green' : 'amber'}
        title={`${t(`tax.kind.${d.kind}` as TranslationKey)}${number ? ` · ${number}` : ''}`}
        subtitle={`${money(d.gross_minor, language)} · ${formatDate(new Date(d.doc_date), language)}`}
        onPress={d.status === 'issued' ? () => run(d.id, async () => { await Linking.openURL((await api.taxDocumentLink(org, d.id)).url); }) : undefined}
        trailing={d.status === 'issued' ? <Badge text={busy === d.id ? '…' : t('tax.open')} tone="ok" /> : <Badge text={t(`tax.status.${d.status}` as TranslationKey)} tone="info" />} />;
    })}</Card> : docs ? <Card><Sub center>{t('tax.empty')}</Sub></Card> : null}
  </>;
}

/** Automatic renewal through Stripe Subscription. Stripe keeps the card; owners change it in Stripe's portal. */
function AutopayCard({ org }: { org: string }) {
  const t = useT();
  const language = useContext(LanguageContext);
  const errorText = useErrorText();
  const [state, setState] = useState<Autopay | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.autopay(org).then(setState, () => {}); }, [org]);
  if (!state || (!state.available && !state.subscription)) return null;
  const sub = state.subscription, live = Boolean(sub?.live), date = sub?.current_period_end ? formatDate(new Date(sub.current_period_end), language) : '';
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <Card>
    <View style={styles.planHead}>
      <IconTile icon="card" tone={live ? 'green' : 'blue'} size={40} />
      <View style={{ flex: 1 }}>
        <Strong>{t('autopay.title')}</Strong>
        <Sub>{live ? t(sub!.cancel_at_period_end ? 'autopay.onStopping' : 'autopay.on', { date })
          : sub?.canceled_by_owner ? t('autopay.ownerStopped') : sub ? t('autopay.stopped') : t('autopay.off')}</Sub>
      </View>
    </View>
    {live && ['past_due', 'unpaid', 'incomplete'].includes(sub!.status) ? <Banner text={t('autopay.pastDue')} /> : null}
    <Banner text={error} />
    {sub ? <Button small kind="secondary" icon="open-outline" title={t('autopay.manage')} busy={busy}
      onPress={() => run(async () => { await Linking.openURL((await api.autopayPortal(org)).url); })} /> : null}
    {live ? <Button small kind="ghost" title={t('autopay.cancel')} busy={busy}
      onPress={() => run(async () => { if (await confirm(t('autopay.cancelConfirm'), t('autopay.cancel'), t('cancel'))) setState(await api.cancelAutopay(org)); })} /> : null}
  </Card>;
}

function Feature({ text }: { text: string }) {
  return <View style={styles.feature}><Icon name="checkmark-circle" size={18} color={colors.success} /><Text style={styles.featureText}>{text}</Text></View>;
}

/** Invoice with where to transfer (BS03), proof upload (BS04) and its review status (BS05). */
export function InvoiceScreen({ membership, invoiceId, onBack }: { membership: Membership; invoiceId: string; onBack: () => void }) {
  const t = useT();
  const language = useContext(LanguageContext);
  const errorText = useErrorText();
  const org = membership.organization_id;
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const proofId = useRef<string | null>(null);
  const checkoutKeys = useRef<Record<string,string>>({});
  const [subscribe, setSubscribe] = useState(false);
  const [autopayLive, setAutopayLive] = useState(false);
  const [method, setMethod] = useState<PayMethod | null>(null);
  const active = invoice?.checkouts?.find(c => ['creating','open'].includes(c.status));
  useEffect(() => { api.invoice(org, invoiceId).then(setInvoice, e => setError(errorText(e))); }, [org, invoiceId]);
  useEffect(() => { if (active?.method === 'card') setSubscribe(active.mode === 'subscription'); }, [active?.id]);
  useEffect(() => { api.autopay(org).then(r => setAutopayLive(Boolean(r.subscription?.live)), () => {}); }, [org, invoice?.status]);
  useEffect(() => {
    if (!active || active.status !== 'open') return;
    let checking = false;
    const refresh = async () => { if(checking)return;checking=true;try{setInvoice(await api.refreshCheckout(org,invoiceId,active.id));}catch{/* Manual status check remains available. */}finally{checking=false;} };
    void refresh();const timer=setInterval(()=>void refresh(),10_000);
    const listener=AppState.addEventListener('change',state=>{if(state==='active')void refresh();});
    return ()=>{clearInterval(timer);listener.remove();};
  },[org,invoiceId,active?.id,active?.status]);
  async function checkout(method:'card'|'promptpay') {
    setBusy(true);setError(null);
    try{
      if(!active&&invoice?.checkouts?.some(c=>c.method===method&&['expired','failed'].includes(c.status))){delete checkoutKeys.current[method];delete checkoutKeys.current['card:subscribe'];}
      // One key per method and choice: a subscription is a different checkout.
      const sub=method==='card'&&subscribe,slot=sub?'card:subscribe':method;
      checkoutKeys.current[slot]??=uuid();
      const result=await api.stripeCheckout(org,invoiceId,method,checkoutKeys.current[slot],sub);
      setInvoice(await api.invoice(org,invoiceId));await Linking.openURL(result.url);
    }catch(e){try{setInvoice(await api.invoice(org,invoiceId));}catch{}setError(errorText(e));}finally{setBusy(false);}
  }
  async function checkoutAction(cancel:boolean) {
    if(!active)return;setBusy(true);setError(null);
    try{setInvoice(await (cancel?api.cancelCheckout(org,invoiceId,active.id):api.refreshCheckout(org,invoiceId,active.id)));if(cancel)checkoutKeys.current={};}
    catch(e){setError(errorText(e));}finally{setBusy(false);}
  }

  async function send(source: 'camera' | 'library') {
    setError(null); setDone(null);
    try {
      const picked = await pickPhoto(source);
      if (!picked) return;
      setBusy(true);
      proofId.current ??= uuid();
      const data = await readPicked(picked);
      const updated = await api.uploadProof(org, invoiceId, proofId.current, data, picked.mimeType);
      setInvoice(updated);
      proofId.current = null;
      setDone(t(updated.status === 'paid' ? 'paymentActivated' : 'proofSent'));
    } catch (e) { setError(e instanceof CameraDeniedError ? t('cameraDenied') : errorText(e)); }
    finally { setBusy(false); }
  }

  if (!invoice) return error ? <Screen onBack={onBack}><Banner text={error} /></Screen> : <Loading />;
  const pending = invoice.proofs.some(p => p.status === 'pending') || Boolean(active);
  const options: PayMethod[] = invoice.status === 'open' && !autopayLive
    ? [invoice.pay_to?.promptpay_qr_png ? 'qr' : null, invoice.pay_to ? 'transfer' : null, invoice.methods?.stripe_card || active ? 'card' : null].filter((m): m is PayMethod => !!m) : [];
  // A checkout in progress keeps the card view (it also shows an older Stripe PromptPay checkout's status).
  const chosen = active && options.includes('card') ? 'card' : method && options.includes(method) ? method : options[0] ?? null;
  return <Screen onBack={onBack}>
    <Sub>{t('invoice')} {invoice.number}</Sub>
    <View style={styles.amountRow}>
      <Title>{money(invoice.amount_minor, language)}</Title>
      <Badge text={t(`invoice.${invoice.status}` as TranslationKey)} tone={invoiceTone(invoice.status)} />
    </View>
    <Sub>{language === 'th' ? invoice.plan_name_th : invoice.plan_name_en} · {t('seatsN', { n: invoice.technician_seats })}</Sub>
    <Banner tone="success" text={done} />
    {invoice.period ? <Banner tone="success" text={t('paidPeriod', { from: formatDate(new Date(invoice.period.start_at), language), to: formatDate(new Date(invoice.period.end_at), language) })} /> : null}
    {invoice.payment && Number(invoice.payment.refunded_minor) > 0 ? <Banner tone="info" text={t('refunded', { amount: money(invoice.payment.refunded_minor, language) })} /> : null}
    {invoice.status==='open'&&autopayLive?<Banner tone="info" text={t('autopay.blocked')}/>:null}
    {chosen ? <>
      {/* Only methods that are set up are offered: own PromptPay QR, bank transfer (both checked by slip), card through Stripe. */}
      <Section>{t('stripe.title')}</Section>
      <View style={styles.methods} accessibilityRole="radiogroup">{options.map(m =>
        <Pressable key={m} accessibilityRole="radio" accessibilityState={{ checked: chosen === m, disabled: Boolean(active) && m !== 'card' }} disabled={Boolean(active) && m !== 'card'}
          onPress={() => setMethod(m)} style={[styles.method, chosen === m && styles.methodOn, Boolean(active) && m !== 'card' && { opacity: .5 }]}>
          <Icon name={payIcons[m]} size={24} color={chosen === m ? colors.primary : colors.muted} />
          <Text style={styles.methodText}>{t(payLabels[m])}</Text>
        </Pressable>)}</View>
      {chosen === 'qr' && invoice.pay_to?.promptpay_qr_png ? <Card>
        <View style={styles.qrBox}>
          <Image source={{ uri: invoice.pay_to.promptpay_qr_png }} style={styles.qr} accessibilityLabel={t('pay.qr')} />
          <Title>{money(invoice.amount_minor, language)}</Title>
          <Sub>{t('pay.payee')}: {invoice.pay_to.account_name}</Sub>
        </View>
        <Button kind="secondary" icon="download" title={t('pay.saveQrPhone')} onPress={async () => {
          setError(null); setDone(null);
          try { await savePngToGallery(invoice.pay_to!.promptpay_qr_png!, `KooChang-QR-${invoice.number}`); setDone(t('pay.qrSaved')); }
          catch (e) { setError(e instanceof GalleryDeniedError ? t('pay.galleryDenied') : errorText(e)); }
        }} />
        <Sub>{t('pay.qrHintApp')}</Sub>
      </Card> : null}
      {chosen === 'transfer' && invoice.pay_to ? <>
        <Sub>{t('pay.transferHint')}</Sub>
        <Card padded={false}>
          <Row icon="business" tone="sky" title={invoice.pay_to.bank_name} subtitle={t('bankName')} />
          <Row icon="person" tone="blue" title={invoice.pay_to.account_name} subtitle={t('accountName')} />
          <Row icon="card" tone="violet" title={invoice.pay_to.account_number} subtitle={t('accountNumber')} />
          <Row icon="pricetag" tone="amber" title={invoice.pay_to.reference} subtitle={t('paymentReference')} />
          <Row icon="cash" tone="green" title={money(invoice.amount_minor, language)} subtitle={t('amountDue')} last />
        </Card>
      </> : null}
      {chosen === 'qr' || chosen === 'transfer' ? <>
        <Section>{t('sendProof')}</Section>
        <Sub>{t('proofHint')}</Sub>
        {!pending ? <View style={styles.actions}>
          <View style={{ flex: 1 }}><Button icon="images" title={t('choosePhoto')} busy={busy} onPress={() => send('library')} /></View>
          <View style={{ flex: 1 }}><Button kind="secondary" icon="camera" title={t('takePhoto')} disabled={busy} onPress={() => send('camera')} /></View>
        </View> : null}
      </> : null}
      {chosen === 'card' ? <>
        {invoice.methods?.stripe_test?<Banner tone="info" text={t('stripe.test')}/>:null}
        {invoice.methods?.stripe_card?<>
          <Sub>{t('pay.chargeBy')}</Sub>
          <View accessibilityRole="radiogroup">{([false, true] as const).map(auto =>
            <Pressable key={String(auto)} accessibilityRole="radio" accessibilityState={{checked:subscribe===auto,disabled:Boolean(active)}} disabled={Boolean(active)} onPress={()=>setSubscribe(auto)}
              style={[styles.charge, subscribe===auto && styles.methodOn]}>
              <Icon name={subscribe===auto?'radio-button-on':'radio-button-off'} size={22} color={colors.primary}/>
              <View style={{flex:1}}><Text style={styles.featureText}>{t(auto?'pay.cardAuto':'pay.cardOnce')}</Text>{auto?<Sub>{t('pay.cardAutoShort')}</Sub>:null}</View>
            </Pressable>)}</View>
          <Button title={t('pay.card')} busy={busy} disabled={Boolean(active&&(active.method!=='card'||(active.mode==='subscription')!==subscribe))||invoice.proofs.some(p=>p.status==='pending')} onPress={()=>checkout('card')}/>
        </>:null}
        {active?<><Sub>{t(`stripe.${active.status}` as TranslationKey)}</Sub><Button title={t('stripe.refresh')} busy={busy} onPress={()=>checkoutAction(false)}/>{active.status==='open'?<Button kind="secondary" title={t('stripe.cancel')} busy={busy} onPress={()=>checkoutAction(true)}/>:null}</>:null}
      </> : null}
    </> : null}
    {invoice.checkouts?.filter(c=>c.reason).map(c=><Banner key={c.id} text={t(`stripe.${c.reason}` as TranslationKey)}/>)}
    <Banner text={error} />

    {invoice.proofs.length ? <>
      <Section>{t('sendProof')}</Section>
      <Card padded={false}>{invoice.proofs.map((p, i) =>
        <Row key={p.id} last={i === invoice.proofs.length - 1} icon="document-attach" tone={p.status === 'rejected' ? 'rose' : p.status === 'accepted' ? 'green' : 'sky'}
          title={formatDate(new Date(p.created_at), language)} subtitle={p.reason || (p.verification_code ? t(`slip.${p.verification_code}` as TranslationKey) : undefined)}
          trailing={<Badge text={t(`proof.${p.status}` as TranslationKey)} tone={proofTone(p.status)} />} />)}
      </Card>
    </> : null}
  </Screen>;
}

type PayMethod = 'qr' | 'transfer' | 'card';
const payIcons = { qr: 'qr-code', transfer: 'business', card: 'card' } as const;
const payLabels = { qr: 'pay.qr', transfer: 'pay.transfer', card: 'pay.card' } as const;

const styles = StyleSheet.create({
  methods: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  method: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 14, paddingHorizontal: 6, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.surface },
  methodOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  methodText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.ink, textAlign: 'center' },
  qrBox: { alignItems: 'center', gap: 6, marginBottom: 8 },
  charge: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, marginBottom: 8, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.surface },
  qr: { width: 260, height: 260, borderRadius: 12, backgroundColor: '#fff' },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  price: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 26 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  featureText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  actions: { flexDirection: 'row', gap: 10 },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginVertical: 8 },
});
