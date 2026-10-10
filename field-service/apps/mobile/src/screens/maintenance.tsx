import { useContext, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { formatPhone } from '@field-service/core';
import { formatDate, type TranslationKey } from '@field-service/i18n';
import { api, ApiFailure, type ContactResult, type MaintenanceItem, type MaintenanceList, type Membership, type TeamMember } from '../api';
import { uuid } from '../photos';
import { Badge, Banner, Button, Card, colors, confirm, Field, fonts, Icon, IconTile, LanguageContext, Loading, Row, Screen, Section, Strong, Sub, Title, tones, useErrorText, useT, type Tone } from '../ui';
import { customerTitle } from './customers';
import { categoryIcon, useEquipmentTitle } from './equipment';
import { atBangkok, bangkokDay, Chip, endOf, WhenPicker } from './jobs';
import { addDays, DatePicker } from '../calendar';

const buckets = ['overdue', 'within_7', 'within_30'] as const;
const bucketLook: Record<MaintenanceItem['bucket'], { key: TranslationKey; tone: Tone; badge: 'danger' | 'warn' | 'info' }> = {
  overdue: { key: 'maintenanceOverdue', tone: 'rose', badge: 'danger' },
  within_7: { key: 'maintenanceWithin7', tone: 'amber', badge: 'warn' },
  within_30: { key: 'maintenanceWithin30', tone: 'teal', badge: 'info' },
};
const results: ContactResult[] = ['no_answer', 'interested', 'call_later', 'declined', 'booked'];
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00+07:00`);
const validDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Owner home: how many cycles need follow-up, coloured by urgency. */
export function MaintenanceCard({ membership, onOpen }: { membership: Membership; onOpen: () => void }) {
  const t = useT();
  const [list, setList] = useState<MaintenanceList | null>(null);
  useEffect(() => { api.maintenance(membership.organization_id).then(setList, () => setList(null)); }, [membership.organization_id]);
  // No row of zero boxes (handoff F17): with nothing due, one line says so.
  const any = !!list && buckets.some(b => list.counts[b] > 0);
  return <Card padded={false}>
    <Row icon="calendar" tone="violet" title={t('maintenanceDueCount')} subtitle={list && !any ? t('maintenance.none') : t('maintenanceHint')} onPress={onOpen} last={!any} />
    {list && any ? <View style={styles.counts}>
      {buckets.map(b => <View key={b} style={[styles.count, { backgroundColor: tones[bucketLook[b].tone][0] }]}>
        <Text style={[styles.countValue, { color: tones[bucketLook[b].tone][1] }]}>{list.counts[b]}</Text>
        <Text style={[styles.countLabel, { color: tones[bucketLook[b].tone][1] }]}>{t(bucketLook[b].key)}</Text>
      </View>)}
    </View> : null}
  </Card>;
}

/** Due list: overdue first, then within 7 and 30 days. */
export function MaintenanceScreen({ membership, onBack, onOpen }: { membership: Membership; onBack: () => void; onOpen: (item: MaintenanceItem) => void }) {
  const t = useT();
  const language = useContext(LanguageContext);
  const errorText = useErrorText();
  const title = useEquipmentTitle();
  const [list, setList] = useState<MaintenanceList | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.maintenance(membership.organization_id).then(setList, e => setError(errorText(e))); }, [membership.organization_id]);
  if (!list && !error) return <Loading />;
  return <Screen onBack={onBack}>
    <Title>{t('maintenance')}</Title>
    <Sub>{t('maintenanceHint')}</Sub>
    <Banner text={error} />
    {list && !list.items.length ? <Card><Sub center>{t('maintenanceEmpty')}</Sub></Card> : null}
    {list ? buckets.map(b => {
      const items = list.items.filter(i => i.bucket === b);
      if (!items.length) return null;
      return <View key={b}>
        <Section action={<Badge text={String(items.length)} tone={bucketLook[b].badge} />}>{t(bucketLook[b].key)}</Section>
        <Card padded={false}>{items.map((item, i) => {
          const [icon, tone] = categoryIcon(item.category);
          return <Row key={item.id} last={i === items.length - 1} onPress={() => onOpen(item)} icon={<IconTile icon={icon} tone={tone} />}
            title={customerTitle({ name: item.customer_name, phone_normalized: item.customer_phone })}
            subtitle={[title({ name: item.equipment_name, category: item.category, brand: item.brand, model: item.model }), item.location_label,
              t('maintenanceDue', { date: formatDate(day(item.due_date), language) })].join(' · ')}
            trailing={item.booked_job_id ? <Badge text={t('bookedJob')} tone="ok" />
              : item.last_contact ? <Badge text={t(`contact.${item.last_contact.result}` as TranslationKey)} /> : undefined} />;
        })}</Card>
      </View>;
    }) : null}
  </Screen>;
}

type Panel = null | 'contact' | 'book' | 'postpone' | 'stop';

/** One cycle: call the customer, log the contact, book a job (with other due units at the same
 * place), postpone with a reason, or stop reminders. */
export function MaintenanceDetail({ membership, item: initial, onBack, onOpenJob, onOpenCustomer }: {
  membership: Membership; item: MaintenanceItem; onBack: () => void; onOpenJob: (id: string) => void; onOpenCustomer: (id: string) => void;
}) {
  const t = useT();
  const language = useContext(LanguageContext);
  const errorText = useErrorText();
  const title = useEquipmentTitle();
  const org = membership.organization_id;
  const [item, setItem] = useState(initial);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // contact
  const [result, setResult] = useState<ContactResult>('no_answer');
  const [note, setNote] = useState('');
  const [nextContact, setNextContact] = useState<string | null>(null);
  // book
  const [siblings, setSiblings] = useState<MaintenanceItem[]>([]);
  const [selected, setSelected] = useState<string[]>([initial.id]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [when, setWhen] = useState<{ day: string | null; time: string; hours: number }>({ day: null, time: '09:00', hours: 2 });
  const bookKey = useRef(uuid());
  // postpone / stop
  const [dueDate, setDueDate] = useState('');
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string>();

  async function reload() {
    const list = await api.maintenance(org, 365);
    const fresh = list.items.find(i => i.id === item.id);
    if (fresh) setItem(fresh);
    setSiblings(list.items.filter(i => i.location_id === item.location_id && i.id !== item.id && !i.booked_job_id));
    return fresh;
  }
  useEffect(() => {
    reload().catch(() => {});
    api.team(org).then(r => {
      const active = r.members.filter(m => m.status === 'active');
      setTeam(active);
      // Owner working alone: the job is theirs unless they pick otherwise.
      if (!active.some(m => m.role === 'technician')) setAssignee(membership.member_id);
    }, () => {});
  }, []);

  function open(next: Panel) { setPanel(panel === next ? null : next); setFailure(null); setFieldError(undefined); setDone(null); }

  async function run(action: () => Promise<string | void>, message: TranslationKey) {
    setBusy(true); setFailure(null);
    try {
      const jobId = await action();
      setDone(t(message)); setPanel(null); setNote(''); setReason('');
      if (jobId) { onOpenJob(jobId); return; }
      await reload().catch(() => {});
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'ALREADY_BOOKED') await reload().catch(() => {});
      setFailure(errorText(e));
    } finally { setBusy(false); }
  }

  const contact = () => run(async () => {
    await api.logContact(org, item.id, { result, note: note.trim() || undefined, next_contact_on: nextContact });
  }, 'contactSaved');
  const book = () => run(async () => {
    const r = await api.bookMaintenance(org, { request_key: bookKey.current, cycle_ids: selected, assignee_member_id: assignee,
      scheduled_start: when.day ? atBangkok(when.day, when.time) : null, scheduled_end: when.day ? endOf(when.day, when.time, when.hours) : null });
    return r.job_id;
  }, 'jobBooked');
  const postpone = () => {
    if (!validDay(dueDate)) { setFieldError(t('field.required')); return; }
    if (!reason.trim()) { setFieldError(undefined); setFailure(t('field.required')); return; }
    return run(async () => { await api.postponeCycle(org, item.id, { expected_version: item.version, due_date: dueDate, reason: reason.trim() }); }, 'postponed');
  };
  const stop = async () => {
    if (!reason.trim()) { setFailure(t('field.required')); return; }
    if (!await confirm(t('stopReminderConfirm'), t('stopReminder'), t('cancel'))) return;
    await run(async () => { await api.stopCycle(org, item.id, reason.trim()); onBack(); }, 'reminderStopped');
  };

  const [icon, tone] = categoryIcon(item.category);
  const look = bucketLook[item.bucket];
  const nextDays = Array.from({ length: 7 }, (_, i) => bangkokDay(i + 1));
  return <Screen onBack={onBack}>
    <View style={styles.header}>
      <IconTile icon={icon} tone={tone} size={48} />
      <View style={{ flex: 1 }}>
        <Title>{title({ name: item.equipment_name, category: item.category, brand: item.brand, model: item.model })}</Title>
        <Sub>{t(`jobType.${item.service_type}` as TranslationKey)}{item.interval_months ? ` · ${t('months', { n: item.interval_months })}` : ''}</Sub>
      </View>
    </View>
    <View style={[styles.due, { backgroundColor: tones[look.tone][0] }]}>
      <Icon name="calendar" size={20} color={tones[look.tone][1]} />
      <Text style={[styles.dueText, { color: tones[look.tone][1] }]}>{t('maintenanceDue', { date: formatDate(day(item.due_date), language) })} · {t(look.key)}</Text>
    </View>
    <Banner text={done} tone="success" />

    <Card padded={false}>
      <Row icon="person" tone="blue" title={customerTitle({ name: item.customer_name, phone_normalized: item.customer_phone })}
        subtitle={item.customer_phone ? formatPhone(item.customer_phone) : t('noPhone')} onPress={() => onOpenCustomer(item.customer_id)} />
      <Row icon="location" tone="sky" title={item.location_label} subtitle={item.location_address ?? undefined} />
      <Row icon="time" tone="teal" last={!item.last_contact && !item.booked_job_id}
        title={item.last_service_at ? t('lastService', { date: formatDate(new Date(item.last_service_at), language) }) : t('neverServiced')} />
      {item.last_contact ? <Row icon="chatbubble-ellipses" tone="amber" last={!item.booked_job_id}
        title={t('lastContact', { result: t(`contact.${item.last_contact.result}` as TranslationKey) })}
        subtitle={[item.last_contact.note, item.last_contact.next_contact_on ? `${t('nextContactOn')} ${formatDate(day(item.last_contact.next_contact_on), language)}` : null].filter(Boolean).join(' · ') || undefined} /> : null}
      {item.booked_job_id ? <Row icon="briefcase" tone="green" title={t('bookedJob')} trailing={<Strong>{t('openJob')}</Strong>} onPress={() => onOpenJob(item.booked_job_id!)} last /> : null}
    </Card>

    {item.customer_phone ? <Button icon="call" title={t('call')} onPress={() => Linking.openURL(`tel:${item.customer_phone}`)} /> : null}
    <View style={styles.actions}>
      <Button small kind="secondary" icon="chatbubble-ellipses-outline" title={t('logContact')} onPress={() => open('contact')} />
      {!item.booked_job_id ? <Button small kind="secondary" icon="briefcase-outline" title={t('bookJob')} onPress={() => open('book')} /> : null}
      <Button small kind="secondary" icon="calendar-outline" title={t('postpone')} onPress={() => open('postpone')} />
      <Button small kind="ghost" icon="notifications-off-outline" title={t('stopReminder')} onPress={() => open('stop')} />
    </View>

    {panel === 'contact' ? <Card>
      <Strong>{t('logContact')}</Strong>
      <View style={styles.chips}>{results.map(r => <Chip key={r} label={t(`contact.${r}` as TranslationKey)} on={result === r} onPress={() => setResult(r)} />)}</View>
      <Field label={t('contactNote')} value={note} onChangeText={setNote} maxLength={1000} multiline />
      {result === 'call_later' || result === 'interested' ? <>
        <Text style={styles.label}>{t('nextContactOn')}</Text>
        <View style={styles.chips}>{nextDays.map((d, i) => <Chip key={d} label={i === 0 ? t('tomorrow') : formatDate(day(d), language)} on={nextContact === d}
          onPress={() => setNextContact(nextContact === d ? null : d)} />)}</View>
      </> : null}
      <Banner text={failure} />
      <Button icon="checkmark" title={t('save')} busy={busy} onPress={contact} />
    </Card> : null}

    {panel === 'book' ? <Card>
      <Strong>{t('bookJob')}</Strong>
      {siblings.length ? <>
        <Text style={styles.label}>{t('alsoBook')}</Text>
        <Card padded={false}>{[item, ...siblings].map((s, i, all) => {
          const on = selected.includes(s.id);
          const [sIcon, sTone] = categoryIcon(s.category);
          return <Row key={s.id} last={i === all.length - 1} icon={<IconTile icon={sIcon} tone={sTone} />}
            title={title({ name: s.equipment_name, category: s.category, brand: s.brand, model: s.model })} subtitle={t('maintenanceDue', { date: formatDate(day(s.due_date), language) })}
            trailing={<Icon name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.faint} />}
            onPress={() => s.id !== item.id && setSelected(on ? selected.filter(x => x !== s.id) : [...selected, s.id])} />;
        })}</Card>
      </> : null}
      <Text style={styles.label}>{t('when')}</Text>
      <WhenPicker {...when} onChange={setWhen} />
      <Text style={styles.label}>{t('assignee')}</Text>
      <View style={styles.chips}>
        <Chip label={t('unassignedOption')} on={assignee === null} onPress={() => setAssignee(null)} />
        {team.map(m => <Chip key={m.member_id} label={m.member_id === membership.member_id ? t('doItMyself') : m.display_name} on={assignee === m.member_id}
          icon={m.role === 'owner' ? 'person-circle' : 'construct'} onPress={() => setAssignee(m.member_id)} />)}
      </View>
      <Banner text={failure} />
      <Button icon="checkmark" title={t('bookJob')} busy={busy} onPress={book} />
    </Card> : null}

    {panel === 'postpone' ? <Card>
      <Strong>{t('postpone')}</Strong>
      <Text style={styles.label}>{t('newDueDate')}{dueDate ? ` · ${formatDate(day(dueDate), language)}` : ''}</Text>
      <DatePicker value={dueDate || null} min={bangkokDay(1)} max={addDays(bangkokDay(0), 730)} onChange={d => { setDueDate(d); setFieldError(undefined); }} />
      {fieldError ? <Banner text={fieldError} /> : null}
      <Field label={t('reasonLabel')} value={reason} onChangeText={setReason} maxLength={500} />
      <Banner text={failure} />
      <Button icon="checkmark" title={t('save')} busy={busy} onPress={postpone} />
    </Card> : null}

    {panel === 'stop' ? <Card>
      <Strong>{t('stopReminder')}</Strong>
      <Sub>{t('stopReminderConfirm')}</Sub>
      <Field label={t('reasonLabel')} value={reason} onChangeText={setReason} maxLength={500} />
      <Banner text={failure} />
      <Button kind="danger" icon="notifications-off" title={t('stopReminder')} busy={busy} onPress={stop} />
    </Card> : null}
    {panel === null ? <Banner text={failure} /> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  counts: { flexDirection: 'row', gap: 8, padding: 12, paddingTop: 0 },
  count: { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  countValue: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 30 },
  countLabel: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  due: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, padding: 12 },
  dueText: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.muted, marginTop: 12, marginBottom: 6 },
});
