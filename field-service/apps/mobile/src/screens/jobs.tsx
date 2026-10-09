import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { formatPhone } from '@field-service/core';
import { formatDate, formatDateTime, formatDayChip, type TranslationKey } from '@field-service/i18n';
import { api, ApiFailure, type Customer, type CustomerHistory, type CustomerSummary, type EquipmentSummary, type Job, type JobStatus, type JobSummary, type Membership, type TeamMember } from '../api';
import { addDays, DatePicker } from '../calendar';
import { uuid } from '../photos';
import { ActionTrio, Badge, Banner, Button, Card, colors, confirm, Field, fonts, Icon, IconTile, LanguageContext, Loading, Row, Screen, Section, Strong, Sub, Title, useErrorText, useT, type IconName, type Tone } from '../ui';
import { customerTitle, mapsUrl, openMaps } from './customers';
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
const hourChoices = Array.from({ length: 16 }, (_, i) => String(i + 6).padStart(2, '0'));

export function Chip({ label, on, onPress, icon }: { label: string; on: boolean; onPress: () => void; icon?: IconName }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
    {icon ? <Icon name={icon} size={16} color={on ? colors.onPrimary : colors.muted} /> : null}
    <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
  </Pressable>;
}

/** Quick chips for the coming week and common times, plus any date within a year (calendar) and
 * any quarter hour from 06:00 to 21:45. No native date-picker dependency. */
export function WhenPicker({ day, time, hours, onChange }: { day: string | null; time: string; hours: number; onChange: (v: { day: string | null; time: string; hours: number }) => void }) {
  const t = useT();
  const language = useContext(LanguageContext);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => bangkokDay(i)), []);
  const otherDay = day !== null && !days.includes(day);
  const [calendar, setCalendar] = useState(false);
  const [clock, setClock] = useState(!times.includes(time));
  const set = (patch: Partial<{ day: string | null; time: string; hours: number }>) => onChange({ day, time, hours, ...patch });
  const [hh, mm] = time.split(':') as [string, string];
  return <>
    <View style={styles.chips}>
      <Chip label={t('notScheduled')} on={day === null} onPress={() => { setCalendar(false); set({ day: null }); }} />
      {days.map((d, i) => <Chip key={d} label={i === 0 ? t('today') : i === 1 ? t('tomorrow') : formatDayChip(new Date(`${d}T12:00:00+07:00`), language)}
        on={day === d} onPress={() => { setCalendar(false); set({ day: d }); }} />)}
      <Chip icon="calendar" label={otherDay ? formatDayChip(new Date(`${day}T12:00:00+07:00`), language) : t('otherDate')} on={otherDay || calendar} onPress={() => setCalendar(!calendar)} />
    </View>
    {calendar ? <DatePicker value={day} min={days[0]!} max={addDays(days[0]!, 365)} onChange={d => { setCalendar(false); set({ day: d }); }} /> : null}
    {day ? <>
      <View style={[styles.chips, { marginTop: 10 }]}>
        {times.map(x => <Chip key={x} label={x} on={!clock && time === x} onPress={() => { setClock(false); set({ time: x }); }} />)}
        <Chip icon="time" label={clock ? time : t('otherTime')} on={clock} onPress={() => setClock(true)} />
      </View>
      {clock ? <>
        <Text style={styles.label}>{t('hourLabel')}</Text>
        <View style={styles.chips}>{hourChoices.map(h => <Chip key={h} label={h} on={hh === h} onPress={() => set({ time: `${h}:${mm}` })} />)}</View>
        <Text style={styles.label}>{t('minuteLabel')}</Text>
        <View style={styles.chips}>{['00', '15', '30', '45'].map(m => <Chip key={m} label={m} on={mm === m} onPress={() => set({ time: `${hh}:${m}` })} />)}</View>
      </> : null}
      <Text style={styles.label}>{t('duration')}</Text>
      <View style={styles.chips}>{[1, 2, 3, 4, 6, 8].map(n => <Chip key={n} label={t('hours', { n })} on={hours === n} onPress={() => set({ hours: n })} />)}</View>
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
export function JobsScreen({ membership, initialFilter = 'today', onOpen, onCreate }: { membership: Membership; initialFilter?: 'today' | 'upcoming' | 'unassigned'; onOpen: (id: string) => void; onCreate: () => void }) {
  const t = useT();
  const errorText = useErrorText();
  const [filter, setFilter] = useState<'today' | 'upcoming' | 'unassigned'>(initialFilter);
  const [items, setItems] = useState<JobSummary[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const query = useMemo(() => {
    const today = bangkokDay(0);
    return filter === 'today' ? { from: atBangkok(today, '00:00'), to: atBangkok(bangkokDay(1), '00:00') }
      : filter === 'upcoming' ? { from: atBangkok(bangkokDay(1), '00:00'), to: atBangkok(bangkokDay(30), '00:00') } : { status: 'unassigned' };
  }, [filter]);
  const shown = (list: JobSummary[]) => filter === 'unassigned' ? list : list.filter(j => j.scheduled_start);
  useEffect(() => {
    const mine = ++seq.current;
    setItems(null); setError(null);
    api.jobs(membership.organization_id, { ...query, limit: '50' }).then(r => { if (mine === seq.current) { setItems(shown(r.items)); setNext(r.next_offset); } },
      e => { if (mine === seq.current) setError(errorText(e)); });
  }, [query, membership.organization_id]);
  async function loadMore() {
    if (next === null || more) return;
    const mine = seq.current;
    setMore(true);
    try {
      const r = await api.jobs(membership.organization_id, { ...query, limit: '50', offset: String(next) });
      if (mine === seq.current) { setItems(prev => [...(prev ?? []), ...shown(r.items).filter(j => !prev?.some(p => p.id === j.id))]); setNext(r.next_offset); }
    } catch (e) { if (mine === seq.current) setError(errorText(e)); } finally { setMore(false); }
  }
  return <Screen title={t('jobs')} right={<Button small kind="tonal" icon="add" title={t('createJob')} onPress={onCreate} />}>
    <View style={styles.chips}>
      {(['today', 'upcoming', 'unassigned'] as const).map(f => <Chip key={f} on={filter === f} onPress={() => setFilter(f)}
        label={t(f === 'today' ? 'filterToday' : f === 'upcoming' ? 'filterUpcoming' : 'filterUnassigned')} />)}
    </View>
    <Banner text={error} />
    {!items ? <Loading /> : items.length === 0 ? <Card><Sub>{t('noJobs')}</Sub></Card>
      : <Card padded={false}>{items.map((j, i) => <JobRow key={j.id} job={j} last={i === items.length - 1} onPress={() => onOpen(j.id)} />)}</Card>}
    {items && next !== null ? <Button kind="secondary" icon="chevron-down" title={t('loadMore')} busy={more} onPress={loadMore} /> : null}
  </Screen>;
}

/** Opening the service form starts a scheduled job first (the server needs in_progress for
 * started_at and photo uploads). Without signal the form still opens and starts the job on send. */
export async function startForService(org: string, job: Job): Promise<Job> {
  if (job.status !== 'scheduled') return job;
  try { const started = await api.jobAction(org, job.id, 'start', { expected_version: job.version }); return 'job' in started ? started.job : started; }
  catch (e) { if (e instanceof ApiFailure && e.code === 'NETWORK_ERROR') return job; throw e; }
}

const clock = (iso: string | null, language: 'th' | 'en') => iso
  ? new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '—';
const callCustomer = (phone: string | null) => { if (phone) void Linking.openURL(`tel:${phone}`); };

/** The job to go to now: one in progress, else the next open one today. Call, navigate and
 * record are on the card so the technician does not need the detail page first. */
function NextJobCard({ membership, job, onOpen, onRecord }: { membership: Membership; job: JobSummary; onOpen: () => void; onRecord: (job: Job) => void }) {
  const t = useT();
  const language = useContext(LanguageContext);
  const errorText = useErrorText();
  const [busy, setBusy] = useState<'nav' | 'record' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const org = membership.organization_id;
  async function navigate() {
    setBusy('nav');
    // The summary has no coordinates; the detail does. Without signal, search the address instead.
    try { const full = await api.job(org, job.id); openMaps({ latitude: full.latitude, longitude: full.longitude, address: full.location_address, label: full.location_label ?? '' }); }
    catch { openMaps({ latitude: null, longitude: null, address: job.location_address, label: job.location_label ?? '' }); }
    finally { setBusy(null); }
  }
  async function record() {
    setBusy('record'); setError(null);
    try { onRecord(await startForService(org, await api.job(org, job.id))); }
    catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  }
  return <View style={styles.hero}>
    <View style={styles.heroHead}>
      <Text style={styles.heroKicker}>{t('nextJob')} · {clock(job.scheduled_start, language)}</Text>
      <Badge text={t(`status.${job.status}` as TranslationKey)} tone={statusTone(job.status)} />
    </View>
    <Text style={styles.heroName}>{customerTitle({ name: job.customer_name, phone_normalized: job.customer_phone })}</Text>
    <Text style={styles.heroSub}>{[job.location_label, t(`jobType.${job.job_type}` as TranslationKey), job.equipment_count ? t('equipmentCount', { count: job.equipment_count }) : null].filter(Boolean).join(' · ')}</Text>
    {job.location_address ? <Text style={styles.heroSub} numberOfLines={2}>{job.location_address}</Text> : null}
    <View style={styles.heroActions}>
      {job.customer_phone ? <Pressable accessibilityRole="button" onPress={() => callCustomer(job.customer_phone)} style={({ pressed }) => [styles.heroGhost, pressed && styles.heroGhostPressed]}>
        <Icon name="call" size={20} color={colors.onPrimary} /><Text style={styles.heroGhostText}>{t('call')}</Text></Pressable> : null}
      <Pressable accessibilityRole="button" disabled={busy !== null} onPress={() => { void navigate(); }} style={({ pressed }) => [styles.heroGhost, pressed && styles.heroGhostPressed]}>
        <Icon name="navigate" size={20} color={colors.onPrimary} /><Text style={styles.heroGhostText}>{t('navigate')}</Text></Pressable>
    </View>
    <Pressable accessibilityRole="button" disabled={busy !== null} onPress={() => { void record(); }} style={({ pressed }) => [styles.heroCta, pressed && { opacity: 0.85 }]}>
      <Icon name={busy === 'record' ? 'hourglass' : 'camera'} size={20} color={colors.ink} /><Text style={styles.heroCtaText}>{t('recordService')}</Text>
    </Pressable>
    {error ? <Text style={styles.heroError}>{error}</Text> : null}
    <Pressable accessibilityRole="button" onPress={onOpen} style={styles.heroLink} hitSlop={4}><Text style={styles.heroLinkText}>{t('viewJobDetails')} ›</Text></Pressable>
  </View>;
}

/** Technician "today": the next job as a card, then own jobs today and next days, in appointment order. */
export function MyJobs({ membership, onOpen, onRecord, onCreate }: { membership: Membership; onOpen: (id: string) => void; onRecord: (job: Job) => void; onCreate?: () => void }) {
  const t = useT();
  const language = useContext(LanguageContext);
  const errorText = useErrorText();
  const [items, setItems] = useState<JobSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    return api.jobs(membership.organization_id, { from: atBangkok(bangkokDay(-1), '00:00'), to: atBangkok(bangkokDay(14), '00:00'), assignee: membership.member_id })
      .then(r => setItems(r.items), e => setError(errorText(e)));
  };
  useEffect(() => {
    void load();
  }, [membership.organization_id, membership.member_id]);
  const createAction = onCreate ? <Button small kind="tonal" icon="calendar-outline" title={t('createJob')} onPress={onCreate} /> : undefined;
  if (error) return <><Banner text={error} /><Button kind="secondary" title={t('retry')} onPress={() => { void load(); }} /></>;
  if (!items) return <Loading />;
  const sorted = [...items].sort((a, b) => (a.scheduled_start ?? '').localeCompare(b.scheduled_start ?? ''));
  const dayOf = (job: JobSummary) => job.scheduled_start ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(job.scheduled_start)) : '';
  const today = bangkokDay(0);
  const next = sorted.find(j => j.status === 'in_progress') ?? sorted.find(j => j.status === 'scheduled' && dayOf(j) === today);
  const groups = new Map<string, JobSummary[]>();
  for (const job of sorted) {
    if (job.id === next?.id) continue;
    groups.set(dayOf(job), [...(groups.get(dayOf(job)) ?? []), job]);
  }
  if (items.length === 0) return <><Section action={createAction}>{t('myJobs')}</Section><Card><Sub>{t('noJobs')}</Sub></Card></>;
  return <>
    {next ? <NextJobCard membership={membership} job={next} onOpen={() => onOpen(next.id)} onRecord={onRecord} /> : null}
    {!groups.size ? (createAction ? <Section action={createAction}>{t('laterToday')}</Section> : null) : null}
    {[...groups].map(([day, jobs], gi) => <View key={day}>
      <Section action={gi === 0 ? createAction : undefined}>{day === today ? (next ? t('laterToday') : t('today')) : day === bangkokDay(1) ? t('tomorrow') : day === bangkokDay(-1) ? t('yesterday') : day ? formatDate(new Date(`${day}T12:00:00+07:00`), language) : t('notScheduled')}</Section>
      <Card padded={false}>{jobs.map((j, i) => <Pressable key={j.id} accessibilityRole="button" onPress={() => onOpen(j.id)} style={[styles.agendaRow, i !== jobs.length - 1 && styles.agendaLine, j.status === 'in_progress' && styles.agendaActive]}>
        <View style={{ flex: 1 }}>
          <View style={styles.agendaHead}><Text style={styles.agendaTime}>{clock(j.scheduled_start, language)}</Text><Badge text={t(`status.${j.status}` as TranslationKey)} tone={statusTone(j.status)} /></View>
          <Strong>{customerTitle({ name: j.customer_name, phone_normalized: j.customer_phone })}</Strong>
          <Sub>{t(`jobType.${j.job_type}` as TranslationKey)} · {j.location_label}</Sub>
        </View>
        {j.customer_phone ? <Pressable accessibilityRole="button" accessibilityLabel={`${t('call')} ${customerTitle({ name: j.customer_name, phone_normalized: j.customer_phone })}`}
          onPress={() => callCustomer(j.customer_phone)} style={({ pressed }) => [styles.callButton, pressed && { backgroundColor: colors.tonal }]}>
          <Icon name="call" size={22} color={colors.primary} /></Pressable> : null}
      </Pressable>)}</Card>
    </View>)}
  </>;
}

/** Pick the customer (search) and, when there are several, the location. A number that is
 * not found yet goes straight to "add customer", carrying the search over. */
export function JobCustomerPicker({ membership, initialCustomer, onBack, onPicked, onCreate }: {
  membership: Membership; initialCustomer?: Customer; onBack: () => void; onPicked: (customerId: string, locationId: string) => void; onCreate: (search: string) => void;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<CustomerSummary[] | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(initialCustomer ?? null);
  const [next, setNext] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(() => { api.customers(membership.organization_id, q.trim()).then(r => { if (mine === seq.current) { setItems(r.items); setNext(r.next_offset); } }, () => {}); }, 250);
    return () => clearTimeout(timer);
  }, [q, membership.organization_id]);
  async function loadMore() {
    if (next === null || more) return;
    const mine = seq.current;
    setMore(true);
    try {
      const r = await api.customers(membership.organization_id, q.trim(), next);
      if (mine === seq.current) { setItems(prev => [...(prev ?? []), ...r.items.filter(c => !prev?.some(p => p.id === c.id))]); setNext(r.next_offset); }
    } catch { /* the button stays for another try */ } finally { setMore(false); }
  }
  async function choose(id: string) {
    const full = await api.customer(membership.organization_id, id);
    if (full.locations.length === 1) onPicked(full.id, full.locations[0]!.id); else setCustomer(full);
  }
  const found = items?.filter(c => c.location_count > 0) ?? [];
  // Customers without a place are hidden here, so a page can come back with nothing to show:
  // keep reading pages until there is something or the list ends.
  const searching = Boolean(items) && found.length === 0 && next !== null;
  useEffect(() => { if (searching && !more) void loadMore(); }, [searching, more]);
  if (customer) return <Screen onBack={() => setCustomer(null)}>
    <Title>{t('chooseLocation')}</Title><Sub>{customerTitle(customer)}</Sub>
    <Card padded={false}>{customer.locations.map((l, i) => <Row key={l.id} icon="home" tone="sky" title={l.label} subtitle={l.address ?? undefined}
      last={i === customer.locations.length - 1} onPress={() => onPicked(customer.id, l.id)} />)}</Card>
  </Screen>;
  return <Screen onBack={onBack}>
    <View style={styles.header}><Title>{t('chooseCustomer')}</Title><Button small icon="person-add" title={t('addCustomer')} onPress={() => onCreate(q)} /></View>
    <Field label={t('searchCustomers')} icon="search" value={q} onChangeText={setQ} autoCorrect={false} placeholder={t('ownerWeb.searchCustomerHint')} />
    {!items || searching ? <Loading /> : found.length === 0
      ? <Card><Sub>{q.trim() ? t('noResults') : t('noCustomers')}</Sub>
          <Button small icon="person-add" title={t('addCustomer')} onPress={() => onCreate(q)} /></Card>
      : <Card padded={false}>{found.map((c, i) => <Row key={c.id} icon="person" tone="violet" title={customerTitle(c)}
        subtitle={[c.name && c.phone_normalized ? formatPhone(c.phone_normalized) : null, c.first_address, c.location_count > 1 ? t('locationCount', { count: c.location_count }) : null].filter(Boolean).join(' · ')} last={i === found.length - 1} onPress={() => { void choose(c.id); }} />)}</Card>}
    {items && next !== null ? <Button kind="secondary" icon="chevron-down" title={t('loadMore')} busy={more} onPress={loadMore} /> : null}
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
  const [teamQuery, setTeamQuery] = useState('');
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const language = useContext(LanguageContext);
  useEffect(() => {
    api.customer(org, customerId).then(setCustomer, () => {});
    api.equipmentList(org, locationId).then(r => setEquipment(r.items), () => {});
    api.customerHistory(org, customerId, locationId).then(setHistory, () => {});
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
        estimated_equipment_count: equipment.length ? selected.length || null : n && Number.isInteger(n) && n > 0 ? n : null, equipment_ids: selected, assignee_member_id: assignee,
      });
      onCreated(result.job.id, result.conflicts.length);
    } catch (e) { setFailure(errorText(e)); } finally { setBusy(false); }
  }

  return <Screen onBack={onBack} footer={<Button icon="checkmark" busy={busy} title={assignee ? t('createAndAssign') : t('createUnassigned')} onPress={submit} />}>
    <Title>{t('createJob')}</Title>
    {customer ? <Sub>{customerTitle(customer)}{location ? ` · ${location.label}` : ''}</Sub> : null}
    {location ? <Card>{location.address ? <Text style={styles.historyText}>{location.address}</Text> : null}{location.travel_note ? <Sub>{location.travel_note}</Sub> : null}
      {location.latitude !== null ? <View style={styles.actions}><Button small kind="secondary" icon="navigate" title={t('ownerWeb.openInMaps')} onPress={() => openMaps(location)} /></View>
        : <Banner tone="info" text={t('ownerWeb.noCoordinatesHint')} />}</Card> : null}
    {history?.open_jobs.length ? <Banner tone="info" text={t('ownerWeb.openJobsWarning', { n: history.open_jobs.length })} /> : null}
    <Section>{t('jobType')}</Section>
    <View style={styles.chips}>{jobTypes.map(x => <Chip key={x} label={t(`jobType.${x}` as TranslationKey)} on={type === x} onPress={() => setType(x)} icon={typeLook[x]![0]} />)}</View>
    <Field label={t('jobDescription')} value={description} onChangeText={setDescription} multiline maxLength={2000} />
    <Section>{t('when')}</Section>
    <WhenPicker {...when} onChange={setWhen} />
    <Section>{t('plannedEquipment')}</Section>
    {equipment.length ? <Card padded={false}>{equipment.map((e, i) => {
      const on = selected.includes(e.id);
      const [icon, tone] = categoryIcon(e.category);
      return <Row key={e.id} last={i === equipment.length - 1} icon={e.thumbnail_url ? <Image source={{ uri: e.thumbnail_url }} style={styles.thumb} /> : <IconTile icon={icon} tone={tone} />}
        title={equipmentTitle(e)} subtitle={e.serial_number ? `S/N ${e.serial_number}` : undefined}
        below={dueBadge(t, language, e.next_due_on)} trailing={<Icon name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.faint} />}
        onPress={() => setSelected(on ? selected.filter(x => x !== e.id) : [...selected, e.id])} />;
    })}</Card> : null}
    {!equipment.length ? <Field label={t('estimatedCount')} hint={t('ownerWeb.noEquipmentHint')} value={estimate} onChangeText={v => setEstimate(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" /> : null}
    <Section>{t('assignee')}</Section>
    {team.length > 6 ? <Field label={t('ownerWeb.pickTechnician')} icon="search" value={teamQuery} onChangeText={setTeamQuery} autoCorrect={false} /> : null}
    <View style={styles.chips}>
      <Chip label={t('unassignedOption')} on={assignee === null} onPress={() => setAssignee(null)} />
      {team.filter(m => m.member_id === assignee || !teamQuery.trim() || m.display_name.toLocaleLowerCase('th').includes(teamQuery.trim().toLocaleLowerCase('th'))).map(m => <Chip key={m.member_id} label={m.member_id === me.memberId ? t('doItMyself') : m.display_name} on={assignee === m.member_id}
        icon={m.role === 'owner' ? 'person-circle' : 'construct'} onPress={() => setAssignee(m.member_id)} />)}
    </View>
    <Banner text={failure} />
    <CustomerHistorySection org={org} customerId={customerId} locationId={locationId} history={history} setHistory={setHistory} />
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

  async function act(action: 'assign' | 'unassign' | 'reschedule' | 'cancel' | 'start', body: Record<string, unknown> = {}): Promise<Job | null> {
    if (!job) return null;
    if (action === 'cancel' && !await confirm(t('cancelJob'), t('cancelJob'), t('cancel'))) return null;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await api.jobAction(org, job.id, action, { expected_version: job.version, ...body });
      const next = 'job' in result ? result.job : result;
      setJob(next); if ('job' in result && result.conflicts.length) setNotice(t('conflictWarning', { count: result.conflicts.length }));
      setPanel('none'); setReason('');
      return next;
    } catch (e) { setError(errorText(e)); if (e instanceof ApiFailure && e.code === 'VERSION_CONFLICT') load(); return null; } finally { setBusy(false); }
  }

  // No separate Start button: recording the service starts a scheduled job first (the server still
  // needs in_progress for started_at and photo uploads), then opens the service form.
  // Without signal the form still opens; it starts the job itself when the record is sent.
  async function recordService() {
    if (!job) return;
    setBusy(true); setError(null);
    try { const next = await startForService(org, job); setJob(next); onRecordService(next); }
    catch (e) { setError(errorText(e)); if (e instanceof ApiFailure && e.code === 'VERSION_CONFLICT') load(); }
    finally { setBusy(false); }
  }

  if (!job) return error ? <Screen onBack={onBack}><Banner text={error} /></Screen> : <Loading />;
  const [icon, tone] = typeLook[job.job_type] ?? typeLook.other!;
  const openJob = ['unassigned', 'scheduled', 'in_progress'].includes(job.status);
  const mine = job.current_assignee_id === membership.member_id;

  const place = { latitude: job.latitude, longitude: job.longitude, address: job.location_address, label: job.location_label ?? '' };
  const canRecord = mine && (job.status === 'scheduled' || job.status === 'in_progress');
  return <Screen onBack={onBack} title={customerTitle({ name: job.customer_name, phone_normalized: job.customer_phone })}
    subtitle={`${t(`jobType.${job.job_type}` as TranslationKey)} · ${job.scheduled_start ? formatDateTime(new Date(job.scheduled_start), language) : t('notScheduled')}`}
    footer={canRecord ? <Button icon="camera" title={t('recordService')} busy={busy} onPress={() => { void recordService(); }} /> : undefined}>
    <View style={styles.header}>
      <IconTile icon={icon} tone={tone} size={44} />
      <View style={{ flex: 1 }}><Strong>{job.location_label ?? ''}</Strong>{job.location_address ? <Sub>{job.location_address}</Sub> : null}</View>
      <Badge text={t(`status.${job.status}` as TranslationKey)} tone={statusTone(job.status)} />
    </View>
    <ActionTrio items={[
      { icon: 'call', label: t('call'), disabled: !job.customer_phone, onPress: () => { void Linking.openURL(`tel:${job.customer_phone}`); } },
      { icon: 'navigate', label: t('navigate'), onPress: () => openMaps(place) },
      { icon: 'share-social', label: t('shareAddress'), onPress: () => { void Share.share({ message: [place.label, place.address, mapsUrl(place)].filter(Boolean).join('\n') }); } },
    ]} />
    <Banner text={error} />
    <Banner tone="info" text={notice} />
    {job.description ? <Card><Sub>{job.description}</Sub></Card> : null}
    <Card padded={false}>
      <Row icon="person" tone="violet" title={t('customerInfo')} subtitle={job.customer_phone ? formatPhone(job.customer_phone) : undefined} onPress={() => onOpenCustomer(job.customer_id)} />
      {job.travel_note ? <Row icon="navigate-circle" tone="sky" title={job.travel_note} subtitle={t('travelNote')} /> : null}
      <Row icon="construct" tone="amber" title={job.assignee_name ?? t('unassignedOption')} subtitle={t('assignee')} last />
    </Card>
    <Section>{t('plannedEquipment')}</Section>
    <Card padded={false}>
      {job.equipment.map((e, i) => { const [ei, et] = categoryIcon(e.category); return <Row key={e.id} icon={<IconTile icon={ei} tone={et} />} title={equipmentTitle(e)}
        subtitle={e.serial_number ?? undefined} last={i === job.equipment.length - 1 && !job.estimated_equipment_count} />; })}
      {job.estimated_equipment_count ? <Row icon="calculator" tone="sky" title={t('estimatedEquipment', { count: job.estimated_equipment_count })} last /> : null}
      {!job.equipment.length && !job.estimated_equipment_count ? <Row icon="help-circle" tone="sky" title={t('unknown')} last /> : null}
    </Card>

    {job.status === 'cancelled' && job.cancellation_reason ? <Banner text={`${t('cancelReason')}: ${job.cancellation_reason}`} /> : null}

    {owner && openJob ? <>
      <View style={styles.actions}>
        <View style={{ flex: 1 }}><Button small kind="secondary" icon="person-add" title={job.current_assignee_id ? t('reassign') : t('assign')} onPress={() => setPanel(panel === 'assign' ? 'none' : 'assign')} /></View>
        <View style={{ flex: 1 }}><Button small kind="secondary" icon="calendar" title={t('reschedule')} onPress={() => setPanel(panel === 'reschedule' ? 'none' : 'reschedule')} /></View>
      </View>
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
  agendaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingLeft: 16, paddingRight: 12 },
  agendaActive: { borderLeftWidth: 4, borderLeftColor: colors.accent, paddingLeft: 12 },
  agendaHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 },
  callButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  hero: { backgroundColor: colors.primary, borderRadius: 20, padding: 16, marginTop: 8 },
  heroHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  heroKicker: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22, color: '#C9D3E0', flex: 1 },
  heroName: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 32, color: colors.onPrimary, marginTop: 6 },
  heroSub: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: '#C9D3E0' },
  heroActions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  heroGhost: { flex: 1, minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', backgroundColor: 'rgba(255,255,255,0.08)', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  heroGhostPressed: { backgroundColor: 'rgba(255,255,255,0.18)' },
  heroGhostText: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, color: colors.onPrimary },
  heroCta: { minHeight: 56, borderRadius: 12, backgroundColor: colors.surface, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  heroCtaText: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, color: colors.ink },
  heroError: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: '#FFD6D1', marginTop: 8 },
  heroLink: { alignSelf: 'center', minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, marginTop: 4 },
  heroLinkText: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22, color: '#DCE4EE' },
  agendaLine: { borderBottomWidth: 1, borderBottomColor: colors.line },
  agendaTime: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 24, color: colors.ink },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.ink },
  chipTextOn: { color: colors.onPrimary },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.muted, marginTop: 12, marginBottom: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  history: { paddingVertical: 6 },
  historyGap: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: 6, paddingTop: 12 },
  historyItem: { marginTop: 6, gap: 2 },
  historyText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.ink },
  historyPhotos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  historyPhoto: { width: 64, height: 64, borderRadius: 8, backgroundColor: colors.line },
  thumb: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.line },
});

/** Open jobs and the latest service at this location, so the person booking sees what was done
 * last time and does not book the same visit twice. Same data as the shop web. */
function CustomerHistorySection({ org, customerId, locationId, history, setHistory }: {
  org: string; customerId: string; locationId: string; history: CustomerHistory | null; setHistory: (h: CustomerHistory) => void;
}) {
  const t = useT();
  const language = useContext(LanguageContext);
  const equipmentTitle = useEquipmentTitle();
  const [more, setMore] = useState(false);
  async function loadMore() {
    if (!history || more) return;
    setMore(true);
    try { const next = await api.customerHistory(org, customerId, locationId, history.items.length); setHistory({ ...next, items: [...history.items, ...next.items] }); }
    catch { /* the button stays for another try */ } finally { setMore(false); }
  }
  if (!history) return null;
  return <>
    <Section>{t('ownerWeb.serviceHistory')}</Section>
    {!history.items.length ? <Sub>{t('ownerWeb.noServiceYet')}</Sub> : <Card>{history.items.map((ev, i) => <View key={ev.id} style={[styles.history, i > 0 && styles.historyGap]}>
      <Strong>{formatDateTime(new Date(ev.occurred_at), language)}</Strong>
      <Sub>{[ev.job_type ? t(`jobType.${ev.job_type}` as TranslationKey) : t('ownerWeb.adhocService'), ev.performed_by_name ? t('ownerWeb.byName', { name: ev.performed_by_name }) : null].filter(Boolean).join(' · ')}</Sub>
      {ev.equipment.map(e => <View key={e.equipment_id} style={styles.historyItem}>
        <Text style={styles.historyText}>{equipmentTitle(e)} · {t(`outcome.${e.outcome}` as TranslationKey)}</Text>
        {e.problem_note ? <Sub>{t('problemNote')}: {e.problem_note}</Sub> : null}
        {e.work_note ? <Sub>{t('workNote')}: {e.work_note}</Sub> : null}
        {e.next_due_on ? <Sub>{t('ownerWeb.nextDue', { date: dayText(e.next_due_on, language) })}</Sub> : null}
        {e.photos.some(p => p.thumbnail_url) ? <View style={styles.historyPhotos}>{e.photos.map((p, k) => p.thumbnail_url
          ? <Pressable key={k} accessibilityRole="imagebutton" accessibilityLabel={p.photo_type} onPress={() => { void Linking.openURL(p.url ?? p.thumbnail_url!); }}>
            <Image source={{ uri: p.thumbnail_url }} style={styles.historyPhoto} /></Pressable> : null)}</View> : null}
      </View>)}
      {ev.note ? <Sub>{ev.note}</Sub> : null}
    </View>)}</Card>}
    {history.has_more ? <Button kind="secondary" icon="chevron-down" title={t('loadMore')} busy={more} onPress={loadMore} /> : null}
  </>;
}
const dayText = (day: string, language: 'th' | 'en') => formatDate(new Date(`${day}T00:00:00+07:00`), language);
/** Due badge for an equipment row: overdue, due within 30 days, or the next date. */
function dueBadge(t: ReturnType<typeof useT>, language: 'th' | 'en', due: string | null | undefined) {
  if (!due) return null;
  const today = bangkokDay(0), soon = bangkokDay(30), date = dayText(due, language);
  return due < today ? <Badge tone="danger" text={t('ownerWeb.overdueSince', { date })} />
    : due <= soon ? <Badge tone="warn" text={t('ownerWeb.dueOn', { date })} /> : <Badge text={t('ownerWeb.nextDue', { date })} />;
}
