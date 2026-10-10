import { useContext, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatDateTime, type TranslationKey } from '@field-service/i18n';
import { api, type Membership, type SupportOverview } from '../api';
import { Badge, Banner, Button, Card, colors, confirm, Field, fonts, LanguageContext, Loading, Row, Screen, Section, Strong, Sub, Title, useErrorText, useT } from '../ui';

const accessTone = (s: string) => s === 'active' ? 'warn' : s === 'pending' ? 'info' : 'neutral';
const ticketTone = (s: string) => s === 'resolved' || s === 'closed' ? 'ok' : s === 'in_progress' ? 'info' : 'warn';

/** Owner: contact the platform team, decide on requests to view shop data, request an export.
 * Also reachable while the shop is suspended. */
export function SupportScreen({ membership, onBack }: { membership: Membership; onBack: () => void }) {
  const t = useT();
  const language = useContext(LanguageContext);
  const errorText = useErrorText();
  const org = membership.organization_id;
  const [data, setData] = useState<SupportOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const load = () => api.support(org).then(setData, e => setError(errorText(e)));
  useEffect(() => { void load(); }, [org]);

  async function run(action: () => Promise<unknown>, done?: TranslationKey) {
    setBusy(true); setError(null); setNotice(null);
    try { await action(); if (done) setNotice(t(done)); await load(); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  if (!data) return error ? <Screen onBack={onBack}><Banner text={error} /></Screen> : <Loading />;
  const pending = data.access.filter(a => a.status === 'pending' || a.status === 'active');
  return <Screen onBack={onBack} title={t('support')}>
    
    <Banner tone="success" text={notice} />
    <Banner text={error} />

    {pending.length ? <>
      <Section>{t('accessRequests')}</Section>
      <Sub>{t('accessHint')}</Sub>
      {pending.map(a => <Card key={a.id}>
        <View style={styles.head}><View style={{ flex: 1 }}><Strong>{a.agent}</Strong></View><Badge text={t(`access.${a.status}` as TranslationKey)} tone={accessTone(a.status)} /></View>
        <Text style={styles.body}>{a.reason}</Text>
        <Sub>{a.scope.map(s => t(`scope.${s}` as TranslationKey)).join(' · ')} · {t('minutesN', { n: a.duration_minutes })}</Sub>
        {a.status === 'active' && a.valid_until ? <Sub>{t('activeUntil', { time: formatDateTime(new Date(a.valid_until), language) })} · {t('readsN', { n: a.reads })}</Sub> : null}
        {a.status === 'pending' && a.consented ? <Sub>{t('waitingApproval')}</Sub> : null}
        <View style={styles.actions}>
          {a.status === 'pending' && !a.consented ? <>
            <View style={{ flex: 1 }}><Button small icon="checkmark" title={t('allow')} busy={busy} onPress={() => run(() => api.supportAccess(org, a.id, 'consent'))} /></View>
            <View style={{ flex: 1 }}><Button small kind="secondary" icon="close" title={t('refuse')} disabled={busy} onPress={() => run(() => api.supportAccess(org, a.id, 'refuse'))} /></View>
          </> : <Button small kind="danger" icon="hand-left-outline" title={t('revokeAccess')} disabled={busy} onPress={() => run(() => api.supportAccess(org, a.id, 'revoke'))} />}
        </View>
      </Card>)}
    </> : null}

    <Section action={!composing ? <Button small icon="add" title={t('newTicket')} onPress={() => setComposing(true)} /> : undefined}>{t('yourTickets')}</Section>
    {composing ? <Card>
      <Field label={t('ticketSubject')} value={subject} onChangeText={setSubject} maxLength={200} />
      <Field label={t('ticketBody')} value={body} onChangeText={setBody} maxLength={4000} multiline />
      <View style={styles.actions}>
        <View style={{ flex: 1 }}><Button kind="secondary" title={t('cancel')} onPress={() => setComposing(false)} /></View>
        <View style={{ flex: 1 }}><Button icon="send" title={t('send')} busy={busy} disabled={!subject.trim() || !body.trim()}
          onPress={() => run(async () => { await api.openTicket(org, subject.trim(), body.trim()); setSubject(''); setBody(''); setComposing(false); })} /></View>
      </View>
    </Card> : null}
    {data.tickets.length ? data.tickets.map(ticket => <Card key={ticket.id} padded={false}>
      <Row icon="chatbubbles" tone="sky" title={ticket.subject} subtitle={formatDateTime(new Date(ticket.last_message_at), language)}
        trailing={<Badge text={t(`ticket.${ticket.status}` as TranslationKey)} tone={ticketTone(ticket.status)} />}
        onPress={() => { setOpen(open === ticket.id ? null : ticket.id); setReply(''); }} last={open !== ticket.id} />
      {open === ticket.id ? <View style={styles.thread}>
        {(ticket.messages ?? []).map(m => <View key={m.id} style={[styles.message, m.from_platform ? styles.fromTeam : styles.fromYou]}>
          <Text style={styles.who}>{m.from_platform ? t('fromTeam') : t('fromYou')} · {formatDateTime(new Date(m.created_at), language)}</Text>
          <Text style={styles.body}>{m.body}</Text>
        </View>)}
        {ticket.status !== 'closed' ? <>
          <Field label={t('reply')} value={reply} onChangeText={setReply} maxLength={4000} multiline />
          <Button small icon="send" title={t('send')} busy={busy} disabled={!reply.trim()} onPress={() => run(async () => { await api.replyTicket(org, ticket.id, reply.trim()); setReply(''); })} />
        </> : null}
      </View> : null}
    </Card>) : <Card><Sub center>{t('noTickets')}</Sub></Card>}

    <Section>{t('requestExport')}</Section>
    {data.data_requests.length ? <Card padded={false}>{data.data_requests.map((d, i) =>
      <Row key={d.id} icon="download" tone="violet" last={i === data.data_requests.length - 1} title={formatDateTime(new Date(d.created_at), language)} subtitle={d.note ?? undefined}
        trailing={<Badge text={t(`dataRequest.${d.status}` as TranslationKey)} tone={d.status === 'succeeded' ? 'ok' : d.status === 'rejected' ? 'danger' : 'info'} />} />)}</Card> : null}
    <Button kind="secondary" icon="download-outline" title={t('requestExport')} disabled={busy} onPress={async () => {
      if (await confirm(t('requestExport'), t('send'), t('cancel'))) await run(() => api.requestExport(org), 'exportRequested');
    }} />
  </Screen>;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.ink, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  thread: { padding: 14, paddingTop: 4, gap: 8 },
  message: { borderRadius: 12, padding: 10 },
  fromTeam: { backgroundColor: '#E0F2FE', marginRight: 24 },
  fromYou: { backgroundColor: '#F1F5F9', marginLeft: 24 },
  who: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18, color: colors.muted },
});
