import { useContext, useEffect, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, Text, View } from 'react-native';
import { formatDate, formatMoney, type TranslationKey } from '@field-service/i18n';
import { api, ApiFailure, type Invoice, type InvoiceSummary, type Membership, type PlanOffer } from '../api';
import { CameraDeniedError, pickPhoto, uuid } from '../photos';
import { Badge, Banner, Button, Card, colors, fonts, Icon, IconTile, LanguageContext, Loading, Row, Screen, Section, Strong, Sub, Title, tones, useErrorText, useT, type Tone } from '../ui';

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
      setError(e instanceof ApiFailure && e.code === 'SEAT_LIMIT_REACHED' ? t('planTooSmall') : errorText(e));
    } finally { setBusy(null); }
  }

  if (!plans && !error) return <Loading />;
  return <Screen onBack={onBack}>
    <Title>{t('choosePlan')}</Title>
    <Sub>{t('renewHint')}</Sub>
    {plans && !plans.payment_available ? <Banner tone="info" text={t('paymentUnavailable')} /> : null}
    <Banner text={error} />
    {plans?.items.map((p, i) => {
      const tone = planTone[i % planTone.length]!;
      return <Card key={p.price_version_id}>
        <View style={styles.planHead}>
          <IconTile icon={i ? 'people' : 'person'} tone={tone} size={44} />
          <View style={{ flex: 1 }}>
            <Strong>{language === 'th' ? p.name_th : p.name_en}</Strong>
            <Text style={[styles.price, { color: tones[tone][1] }]}>{t('perMonth', { amount: money(p.amount_minor, language) })}</Text>
          </View>
        </View>
        <Feature text={t('seatsN', { n: p.technician_seats })} />
        <Feature text={t('storageN', { n: Math.round(Number(p.storage_bytes) / 1e9) })} />
        <Feature text={t('ocrN', { n: p.ocr_per_period })} />
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
  </Screen>;
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
  const active = invoice?.checkouts?.find(c => ['creating','open'].includes(c.status));
  useEffect(() => { api.invoice(org, invoiceId).then(setInvoice, e => setError(errorText(e))); }, [org, invoiceId]);
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
      if(!active&&invoice?.checkouts?.some(c=>c.method===method&&['expired','failed'].includes(c.status)))delete checkoutKeys.current[method];
      checkoutKeys.current[method]??=uuid();
      const result=await api.stripeCheckout(org,invoiceId,method,checkoutKeys.current[method]);
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
      const data = await (await fetch(picked.uri)).blob();
      const updated = await api.uploadProof(org, invoiceId, proofId.current, data, picked.mimeType);
      setInvoice(updated);
      proofId.current = null;
      setDone(t(updated.status === 'paid' ? 'paymentActivated' : 'proofSent'));
    } catch (e) { setError(e instanceof CameraDeniedError ? t('cameraDenied') : errorText(e)); }
    finally { setBusy(false); }
  }

  if (!invoice) return error ? <Screen onBack={onBack}><Banner text={error} /></Screen> : <Loading />;
  const pending = invoice.proofs.some(p => p.status === 'pending') || Boolean(active);
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
    {invoice.status==='open'&&(invoice.methods?.stripe_card||invoice.methods?.stripe_qr||active)?<>
      <Section>{t('stripe.title')}</Section><Sub>{t('stripe.hint')}</Sub>
      {invoice.methods?.stripe_test?<Banner tone="info" text={t('stripe.test')}/>:null}
      {invoice.methods?.stripe_qr?<Button title={t('stripe.qr')} busy={busy} disabled={Boolean(active&&active.method!=='promptpay')||invoice.proofs.some(p=>p.status==='pending')} onPress={()=>checkout('promptpay')}/>:null}
      {invoice.methods?.stripe_card?<Button kind="secondary" title={t('stripe.card')} busy={busy} disabled={Boolean(active&&active.method!=='card')||invoice.proofs.some(p=>p.status==='pending')} onPress={()=>checkout('card')}/>:null}
      {active?<><Sub>{t(`stripe.${active.status}` as TranslationKey)}</Sub><Button title={t('stripe.refresh')} busy={busy} onPress={()=>checkoutAction(false)}/>{active.status==='open'?<Button kind="secondary" title={t('stripe.cancel')} busy={busy} onPress={()=>checkoutAction(true)}/>:null}</>:null}
    </>:null}
    {invoice.checkouts?.filter(c=>c.reason).map(c=><Banner key={c.id} text={t(`stripe.${c.reason}` as TranslationKey)}/>)}

    {invoice.pay_to ? <>
      <Section>{t('payTo')}</Section>
      <Card padded={false}>
        <Row icon="business" tone="sky" title={invoice.pay_to.bank_name} subtitle={t('bankName')} />
        <Row icon="person" tone="blue" title={invoice.pay_to.account_name} subtitle={t('accountName')} />
        <Row icon="card" tone="violet" title={invoice.pay_to.account_number} subtitle={t('accountNumber')} />
        {invoice.pay_to.promptpay_id ? <Row icon="qr-code" tone="teal" title={invoice.pay_to.promptpay_id} subtitle={t('promptPay')} /> : null}
        <Row icon="pricetag" tone="amber" title={invoice.pay_to.reference} subtitle={t('paymentReference')} />
        <Row icon="cash" tone="green" title={money(invoice.amount_minor, language)} subtitle={t('amountDue')} last />
      </Card>
      <Sub>{t('proofHint')}</Sub>
      {!pending ? <View style={styles.actions}>
        <View style={{ flex: 1 }}><Button icon="images" title={t('choosePhoto')} busy={busy} onPress={() => send('library')} /></View>
        <View style={{ flex: 1 }}><Button kind="secondary" icon="camera" title={t('takePhoto')} disabled={busy} onPress={() => send('camera')} /></View>
      </View> : null}
    </> : null}
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

const styles = StyleSheet.create({
  planHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  price: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 26 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  featureText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  actions: { flexDirection: 'row', gap: 10 },
});
