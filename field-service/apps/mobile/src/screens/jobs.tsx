import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatPhone } from '@field-service/core';
import { formatDateTime, formatDayChip, type TranslationKey } from '@field-service/i18n';
import { api, ApiFailure, type Customer, type CustomerSummary, type EquipmentSummary, type Job, type JobStatus, type JobSummary, type Membership, type TeamMember } from '../api';
import { uuid } from '../photos';
import { Badge, Banner, Button, Card, colors, confirm, Field, fonts, Icon, IconTile, LanguageContext, Loading, Row, Screen, Section, Strong, Sub, Title, useErrorText, useT, type IconName, type Tone } from '../ui';
import { customerTitle, openMaps } from './customers';
import { categoryIcon, useEquipmentTitle } from './equipment';

const jobTypes = ['maintenance', 'repair', 'installation', 'inspection', 'other'] as const;
const typeLook: Record<string, [IconName, Tone]> = {
  maintenance: ['sparkles', 'teal'], repair: ['build', 'rose'], installation: ['hammer', 'amber'], inspection: ['search', 'violet'], other: ['ellipsis-horizontal', 'blue'],
};
const statusTone = (s: JobStatus) => s === 'scheduled' ? 'info' : s === 'in_progress' ? 'warn' : s === 'completed' ? 'ok' : s === 'cancelled' ? 'danger' : 'neutral';

/** YYYY-MM-DD in Bangkok for an offset of days from today. */
export function bangkokDay(offset: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(Date.now() + offset * 86400000));
}
export const atBangkok = (day: string, time: string) => `${day}T${time}:00+07:00`;
const times = ['08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00'];

export function Chip({ label, on, onPress, icon }: { label: string; on: boolean; onPress: () => void; icon?: IconName }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
    {icon ? <Icon name={icon} size={16} color={on ? colors.onPrimary : colors.muted} /> : null}
    <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
  </Pressable>;
}

/** Date chips (no time / today … +6), time chips and duration — no date-picker dependency. */
export function WhenPicker({ day, time, hours, onChange }: { day: string | null; time: string; hours: number; onChange: (v: { day: string | null; time: string; hours: number }) => void }) {
  const t = useT();
  const language = useContext(LanguageContext);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => bangkokDay(i)), []);
  return <>
    <View style={styles.chips}>
      <Chip label={t('notScheduled')} on={day === null} onPress={() => onChange({ day: null, time, hours })} />
      {days.map((d, i) => <Chip key={d} label={i === 0 ? t('today') : i === 1 ? t('tomorrow') : formatDayChip(new Date(`${d}T12:00:00+07:00`), language)}
        on={day === d} onPress={() => onChange({ day: d, time, hours })} />)}
    </View>
    {day ? <>
      <View style={[styles.chips, { marginTop: 10 }]}>{times.map(x => <Chip key={x} label={x} on={time === x} onPress={() => onChange({ day, time: x, hours })} />)}</View>
      <Text style={styles.label}>{t('duration')}</Text>
      <View style={styles.chips}>{[1, 2, 3, 4].map(n => <Chip key={n} label={t('hours', { n })} on={hours === n} onPress={() => onChange({ day, time, hours: n })} />)}</View>
    </> : null}
  </>;
}

export const endOf = (day: string, time: string, hours: number) => new Date(new Date(atBangkok(day, time)).getTime() + hours * 3600000).toISOString();

function JobRow({ job, onPress, last }: { job: JobSummary; onPress: () => void; last?: boolean }) {
  const t = useT();
  const language = useContext(LanguageContext);
  const [icon, tone] = typeLook[job.job_type] ?? typeLook.other!;
  return <Row last={last} onPress={onPress} icon={<IconTile icon={icon} tone={tone} />}
    title={customerTitle({ name: job.customer_name, phone_normalized: job.customer_phone })}
    subtitle={[job.scheduled_start ? formatDateTime(new Date(job.scheduled_start), language) : t('notScheduled'), job.location_label, job.assignee_name ?? t('unassignedOption')].filter(Boolean).join(' · ')}
    trailing={<Badge text={t(`status.${job.status}` as TranslationKey)} tone={statusTone(job.status)} />} />;
}

/** Owner job board: today, upcoming, or waiting for a technician. */
export function JobsScreen({ membership, onOpen, onCreate }: { membership: Membership; onOpen: (id: string) => void; onCreate: () => void }) {
  const t = useT();
  const errorText = useErrorText();
  const [filter, setFilter] = useState<'today' | 'upcoming' | 'unassigned'>('today');
  const [items, setItems] = useState<JobSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setItems(null);
    const today = bangkokDay(0);
    const query = filter === 'today' ? { from: atBangkok(today, '00:00'), to: atBangkok(bangkokDay(1), '00:00') }
      : filter === 'upcoming' ? { from: atBangkok(bangkokDay(1), '00:00'), to: atBangkok(bangkokDay(30), '00:00') } : { status: 'unassigned' };
    api.jobs(membership.organization_id, query).then(r => setItems(filter === 'unassigned' ? r.items : r.items.filter(j => j.scheduled_start)), e => setError(errorText(e)));
  }, [filter, membership.organization_id]);
  return <Screen>
    <View style={styles.header}><Title>{t('jobs')}</Title><Button small icon="add" title={t('createJob')} onPress={onCreate} /></View>
    <View style={styles.chips}>
      {(['today', 'upcoming', 'unassigned'] as const).map(f => <Chip key={f} on={filter === f} onPress={() => setFilter(f)}
        label={t(f === 'today' ? 'filterToday' : f === 'upcoming' ? 'filterUpcoming' : 'filterUnassigned')} />)}
    </View>
    <Banner text={error} />
    {!items ? <Loading /> : items.length === 0 ? <Card><Sub>{t('noJobs')}</Sub></Card>
      : <Card padded={false}>{items.map((j, i) => <JobRow key={j.id} job={j} last={i === items.length - 1} onPress={() => onOpen(j.id)} />)}</Card>}
  </Screen>;
}

/** Technician "today": own jobs today and next days, in appointment order. */
export function MyJobs({ membership, onOpen }: { membership: Membership; onOpen: (id: string) => void }) {
  const t = useT();
  const [items, setItems] = useState<JobSummary[] | null>(null);
  useEffect(() => {
    api.jobs(membership.organization_id, { from: atBangkok(bangkokDay(-1), '00:00'), to: atBangkok(bangkokDay(14), '00:00'), assignee: membership.member_id })
      .then(r => setItems(r.items), () => setItems([]));
  }, [membership.organization_id]);
  if (!items) return <Loading />;
  return items.length === 0 ? <Card><Sub>{t('noJobs')}</Sub></Card>
    : <Card padded={false}>{items.map((j, i) => <JobRow key={j.id} job={j} last={i === items.length - 1} onPress={() => onOpen(j.id)} />)}</Card>;
}

/** Pick the customer (search) and, when there are several, the location. A number that is
 * not found yet goes straight to "add customer", carrying the search over. */
export function JobCustomerPicker({ membership, onBack, onPicked, onCreate }: {
  membership: Membership; onBack: () => void; onPicked: (customerId: string, locationId: string) => void; onCreate: (search: string) => void;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<CustomerSummary[] | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(() => { api.customers(membership.organization_id, q.trim()).then(r => { if (mine === seq.current) setItems(r.items); }, () => {}); }, 250);
    return () => clearTimeout(timer);
  }, [q, membership.organization_id]);
  async function choose(id: string) {
    const full = await api.customer(membership.organization_id, id);
    if (full.locations.length === 1) onPicked(full.id, full.locations[0]!.id); else setCustomer(full);
  }
  if (customer) return <Screen onBack={() => setCustomer(null)}>
    <Title>{t('chooseLocation')}</Title><Sub>{customerTitle(customer)}</Sub>
    <Card padded={false}>{customer.locations.map((l, i) => <Row key={l.id} icon="home" tone="sky" title={l.label} subtitle={l.address ?? undefined}
      last={i === customer.locations.length - 1} onPress={() => onPicked(customer.id, l.id)} />)}</Card>
  </Screen>;
  const found = items?.filter(c => c.location_count > 0) ?? [];
  return <Screen onBack={onBack}>
    <View style={styles.header}><Title>{t('chooseCustomer')}</Title><Button small icon="person-add" title={t('addCustomer')} onPress={() => onCreate(q)} /></View>
    <Field label={t('searchCustomers')} icon="search" value={q} onChangeText={setQ} autoCorrect={false} placeholder="08x-xxx-xxxx" />
    {!items ? <Loading /> : found.length === 0
      ? <Card><Sub>{q.trim() ? t('noResults') : t('noCustomers')}</Sub>
          <Button small icon="person-add" title={t('addCustomer')} onPress={() => onCreate(q)} /></Card>
      : <Card padded={false}>{found.map((c, i) => <Row key={c.id} icon="person" tone="violet" title={customerTitle(c)}
        subtitle={t('locationCount', { count: c.location_count })} last={i === found.length - 1} onPress={() => { void choose(c.id); }} />)}</Card>}
  </Screen>;
}

/** Plan a job: type, details, appointment, known equipment or an estimate, technician. */
export function JobForm({ membership, me, customerId, locationId, onBack, onCreated }: {
  membership: Membership; me: { memberId: string }; customerId: string; locationId: string; onBack: () => void; onCreated: (jobId: string, conflicts: number) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const equipmentTitle = useEquipmentTitle();
  const org = membership.organization_id;
  const key = useRef(uuid()).current;
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [equipment, setEquipment] = useState<EquipmentSummary[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [type, setType] = useState<string>('maintenance');
  const [description, setDescription] = useState('');
  const [when, setWhen] = useState<{ day: string | null; time: string; hours: number }>({ day: bangkokDay(1), time: '09:00', hours: 2 });
  const [selected, setSelected] = useState<string[]>([]);
  const [estimate, setEstimate] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.customer(org, customerId).then(setCustomer, () => {});
    api.equipmentList(org, locationId).then(r => setEquipment(r.items), () => {});
    api.team(org).then(r => {
      const active = r.members.filter(m => m.status === 'active');
      setTeam(active);
      // Owner working alone: the job is theirs unless they pick otherwise.
      if (!active.some(m => m.role === 'technician')) setAssignee(me.memberId);
    }, () => {});
  }, []);
  const location = customer?.locations.find(l => l.id === locationId);

  async function submit() {
    setBusy(true); setFailure(null);
    try {
      const n = estimate.trim() ? Number(estimate) : null;
      const result = await api.createJob(org, {
        request_key: key, customer_id: customerId, location_id: locationId, job_type: type, description: description.trim() || undefined,
        scheduled_start: when.day ? atBangkok(when.day, when.time) : null, scheduled_end: when.day ? endOf(when.day, when.time, when.hours) : null,
        estimated_equipment_count: n && Number.isInteger(n) && n > 0 ? n : null, equipment_ids: selected, assignee_member_id: assignee,
      });
      onCreated(result.job.id, result.conflicts.length);
    } catch (e) { setFailure(errorText(e)); } finally { setBusy(false); }
  }

  return <Screen onBack={onBack} footer={<Button icon="checkmark" busy={busy} title={assignee ? t('createAndAssign') : t('createUnassigned')} onPress={submit} />}>
    <Title>{t('createJob')}</Title>
    {customer ? <Sub>{customerTitle(customer)}{location ? ` · ${location.label}` : ''}</Sub> : null}
    <Section>{t('jobType')}</Section>
    <View style={styles.chips}>{jobTypes.map(x => <Chip key={x} label={t(`jobType.${x}` as TranslationKey)} on={type === x} onPress={() => setType(x)} icon={typeLook[x]![0]} />)}</View>
    <Field label={t('jobDescription')} value={description} onChangeText={setDescription} multiline maxLength={2000} />
    <Section>{t('when')}</Section>
    <WhenPicker {...when} onChange={setWhen} />
    <Section>{t('plannedEquipment')}</Section>
    {equipment.length ? <Card padded={false}>{equipment.map((e, i) => {
      const on = selected.includes(e.id);
      const [icon, tone] = categoryIcon(e.category);
      return <Row key={e.id} last={i === equipment.length - 1} icon={<IconTile icon={icon} tone={tone} />} title={equipmentTitle(e)} subtitle={e.serial_number ?? undefined}
        trailing={<Icon name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.faint} />}
        onPress={() => setSelected(on ? selected.filter(x => x !== e.id) : [...selected, e.id])} />;
    })}</Card> : null}
    <Field label={t('estimatedCount')} value={estimate} onChangeText={v => setEstimate(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" />
    <Section>{t('assignee')}</Section>
    <View style={styles.chips}>
      <Chip label={t('unassignedOption')} on={assignee === null} onPress={() => setAssignee(null)} />
      {team.map(m => <Chip key={m.member_id} label={m.member_id === me.memberId ? t('doItMyself') : m.display_name} on={assignee === m.member_id}
        icon={m.role === 'owner' ? 'person-circle' : 'construct'} onPress={() => setAssignee(m.member_id)} />)}
    </View>
    <Banner text={failure} />
  </Screen>;
}

export function JobDetail({ membership, jobId, conflicts, onBack, onOpenCustomer, onRecordService }: {
  membership: Membership; jobId: string; conflicts?: number; onBack: () => void; onOpenCustomer: (id: string) => void; onRecordService: (job: Job) => void;
}) {
  const t = useT();
  const language = useContext(LanguageContext);
  const errorText = useErrorText();
  const equipmentTitle = useEquipmentTitle();
  const org = membership.organization_id;
  const owner = membership.role === 'owner';
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(conflicts ? t('conflictWarning', { count: conflicts }) : null);
  const [panel, setPanel] = useState<'none' | 'assign' | 'reschedule' | 'cancel'>('none');
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [reason, setReason] = useState('');
  const [when, setWhen] = useState<{ day: string | null; time: string; hours: number }>({ day: bangkokDay(1), time: '09:00', hours: 2 });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.job(org, jobId).then(setJob, e => setError(errorText(e))); }, [jobId]);
  useEffect(load, [load]);
  useEffect(() => { if (owner) api.team(org).then(r => setTeam(r.members.filter(m => m.status === 'active')), () => {}); }, []);

  async function act(action: 'assign' | 'unassign' | 'reschedule' | 'cancel' | 'start', body: Record<string, unknown> = {}) {
    if (!job) return;
    if (action === 'cancel' && !await confirm(t('cancelJob'), t('cancelJob'), t('cancel'))) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await api.jobAction(org, job.id, action, { expected_version: job.version, ...body });
      if ('job' in result) { setJob(result.job); if (result.conflicts.length) setNotice(t('conflictWarning', { count: result.conflicts.length })); } else setJob(result);
      setPanel('none'); setReason('');
    } catch (e) { setError(errorText(e)); if (e instanceof ApiFailure && e.code === 'VERSION_CONFLICT') load(); } finally { setBusy(false); }
  }

  if (!job) return error ? <Screen onBack={onBack}><Banner text={error} /></Screen> : <Loading />;
  const [icon, tone] = typeLook[job.job_type] ?? typeLook.other!;
  const openJob = ['unassigned', 'scheduled', 'in_progress'].includes(job.status);
  const mine = job.current_assignee_id === membership.member_id;

  return <Screen onBack={onBack}>
    <View style={styles.header}>
      <IconTile icon={icon} tone={tone} size={56} />
      <View style={{ flex: 1 }}><Title>{t(`jobType.${job.job_type}` as TranslationKey)}</Title>
        <Sub>{job.scheduled_start ? formatDateTime(new Date(job.scheduled_start), language) : t('notScheduled')}</Sub></View>
      <Badge text={t(`status.${job.status}` as TranslationKey)} tone={statusTone(job.status)} />
    </View>
    <Banner text={error} />
    <Banner tone="info" text={notice} />
    {job.description ? <Card><Sub>{job.description}</Sub></Card> : null}
    <Card padded={false}>
      <Row icon="person" tone="violet" title={customerTitle({ name: job.customer_name, phone_normalized: job.customer_phone })}
        subtitle={job.customer_name && job.customer_phone ? formatPhone(job.customer_phone) : undefined} onPress={() => onOpenCustomer(job.customer_id)}
        trailing={job.customer_phone ? <Pressable accessibilityRole="button" accessibilityLabel={t('call')} hitSlop={8}
          onPress={() => { void Linking.openURL(`tel:${job.customer_phone}`); }}><IconTile icon="call" tone="green" /></Pressable> : undefined} />
      <Row icon="location" tone={job.latitude !== null ? 'green' : 'sky'} title={job.location_label ?? ''} subtitle={[job.location_address, job.travel_note].filter(Boolean).join(' · ') || undefined}
        trailing={<Pressable accessibilityRole="button" accessibilityLabel={t('navigate')} hitSlop={8}
          onPress={() => openMaps({ latitude: job.latitude, longitude: job.longitude, address: job.location_address, label: job.location_label ?? '' })}><IconTile icon="navigate" tone="blue" /></Pressable>} />
      <Row icon="construct" tone="amber" title={job.assignee_name ?? t('unassignedOption')} subtitle={t('assignee')} last />
    </Card>
    <Section>{t('plannedEquipment')}</Section>
    <Card padded={false}>
      {job.equipment.map((e, i) => { const [ei, et] = categoryIcon(e.category); return <Row key={e.id} icon={<IconTile icon={ei} tone={et} />} title={equipmentTitle(e)}
        subtitle={e.serial_number ?? undefined} last={i === job.equipment.length - 1 && !job.estimated_equipment_count} />; })}
      {job.estimated_equipment_count ? <Row icon="calculator" tone="sky" title={t('estimatedEquipment', { count: job.estimated_equipment_count })} last /> : null}
      {!job.equipment.length && !job.estimated_equipment_count ? <Row icon="help-circle" tone="sky" title={t('unknown')} last /> : null}
    </Card>

    {!owner && mine && job.status === 'scheduled' ? <Button icon="play" title={t('startJob')} busy={busy} onPress={() => act('start')} /> : null}
    {mine && job.status === 'in_progress' ? <Button icon="clipboard" title={t('recordService')} onPress={() => onRecordService(job)} /> : null}
    {job.status === 'cancelled' && job.cancellation_reason ? <Banner text={`${t('cancelReason')}: ${job.cancellation_reason}`} /> : null}

    {owner && openJob ? <>
      <View style={styles.actions}>
        <View style={{ flex: 1 }}><Button small kind="secondary" icon="person-add" title={job.current_assignee_id ? t('reassign') : t('assign')} onPress={() => setPanel(panel === 'assign' ? 'none' : 'assign')} /></View>
        <View style={{ flex: 1 }}><Button small kind="secondary" icon="calendar" title={t('reschedule')} onPress={() => setPanel(panel === 'reschedule' ? 'none' : 'reschedule')} /></View>
      </View>
      {mine && job.status === 'scheduled' ? <Button small icon="play" title={t('startJob')} busy={busy} onPress={() => act('start')} /> : null}
      {panel === 'assign' ? <Card>
        <View style={styles.chips}>{team.map(m => <Chip key={m.member_id} label={m.member_id === membership.member_id ? t('doItMyself') : m.display_name}
          on={job.current_assignee_id === m.member_id} onPress={() => act('assign', { assignee_member_id: m.member_id, reason: reason.trim() || undefined })} />)}</View>
        {job.status === 'in_progress' ? <Field label={t('reasonOptional')} hint={t('reasonRequiredInProgress')} value={reason} onChangeText={setReason} /> : null}
        {job.status === 'scheduled' ? <Button small kind="ghost" icon="person-remove" title={t('unassign')} busy={busy} onPress={() => act('unassign')} /> : null}
      </Card> : null}
      {panel === 'reschedule' ? <Card>
        <WhenPicker {...when} onChange={setWhen} />
        <Button small icon="checkmark" title={t('save')} busy={busy} onPress={() => act('reschedule', when.day
          ? { scheduled_start: atBangkok(when.day, when.time), scheduled_end: endOf(when.day, when.time, when.hours) } : { scheduled_start: null, scheduled_end: null })} />
      </Card> : null}
      {panel === 'cancel' ? <Card>
        <Field label={t('cancelReason')} value={reason} onChangeText={setReason} maxLength={500} />
        <Button small kind="danger" icon="close-circle" title={t('cancelJob')} busy={busy} disabled={!reason.trim()} onPress={() => act('cancel', { reason: reason.trim() })} />
      </Card> : <Button kind="ghost" icon="close-circle-outline" title={t('cancelJob')} onPress={() => setPanel('cancel')} />}
    </> : null}

    {job.history.length ? <><Section>{t('history')}</Section><Card>
      {job.history.map((h, i) => <View key={i} style={styles.history}>
        <Strong>{t(`status.${h.to_status}` as TranslationKey)}</Strong>
        <Sub>{[formatDateTime(new Date(h.created_at), language), h.actor, h.reason].filter(Boolean).join(' · ')}</Sub>
      </View>)}
    </Card></> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.ink },
  chipTextOn: { color: colors.onPrimary },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.muted, marginTop: 12, marginBottom: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  history: { paddingVertical: 6 },
});
