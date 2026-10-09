import { useContext, useEffect, useRef, useState } from 'react';
import { AppState, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDate, formatDateTime, type TranslationKey } from '@field-service/i18n';
import { api, ApiFailure, type EquipmentHistory, type EquipmentSummary, type Job, type Membership, type NextMaintenance, type ServiceItemInput, type ServiceResult } from '../api';
import { CameraDeniedError, dropKeptPhoto, keepPhoto, pickPhoto, uploadPhoto, uuid } from '../photos';
import { clearDraft, listDrafts, loadDraft, saveDraft } from '../drafts';
import { Badge, Banner, Button, Card, colors, Disclosure, Field, fonts, Icon, IconTile, LanguageContext, Loading, Row, Screen, Section, Strong, Sub, Title, useErrorText, useT } from '../ui';
import { customerTitle } from './customers';
import { categoryIcon, useEquipmentTitle } from './equipment';

const serviceTypes = ['maintenance', 'repair', 'inspection', 'installation', 'other'] as const;
const outcomeTone = (o: string) => o === 'done' ? 'ok' : o === 'not_done' ? 'danger' : 'warn';
type NextChoice = 'keep' | 3 | 6 | 12 | 'none';
/** A photo the server has (id), or one still waiting on this phone (key + local file). The key is
 * its upload request key, so sending it again never stores it twice. */
interface Photo { id: string | null; thumb: string | null; key?: string; local?: string; mime?: string }
interface Draft {
  service_type: string; outcome: 'done' | 'not_done' | 'deferred'; work_note: string; problem_note: string; not_done_reason: string;
  before: Photo[]; after: Photo[]; next: NextChoice;
}
const allPhotos = (drafts: Record<string, Draft>) => Object.values(drafts).flatMap(d => [...d.before, ...d.after]);

/** Calendar months like the server: the same day n months later, or the month's last day. */
function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
const todayBangkok = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());

function Chip({ label, on, onPress, tone }: { label: string; on: boolean; onPress: () => void; tone?: string }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={onPress}
    style={[styles.chip, on && { backgroundColor: tone ?? colors.primary, borderColor: tone ?? colors.primary }]}>
    <Text style={[styles.chipText, on && { color: colors.onPrimary }]}>{label}</Text>
  </Pressable>;
}

/** Where an unsent record belongs, so Home can reopen it. */
export interface DraftTarget { jobId?: string; customerId: string; locationId: string; title: string }
interface SavedForm { clientEventId: string; occurredAt: string; drafts: Record<string, Draft>; note: string; target?: DraftTarget; memberId?: string }
/** Drafts belong to the person who wrote them: on a shared phone each member sees only their own.
 * Drafts saved before 0.2.14 carry no member; whoever reopens one first takes it over. */
const draftPrefix = (m: Membership) => `service:${m.organization_id}:m:${m.member_id}:`;
const legacyDraftKey = (org: string, jobId: string | undefined, locationId: string) => `service:${org}:${jobId ?? `adhoc:${locationId}`}`;

/** Record what was actually done, unit by unit. The client event id is kept with the entries,
 * so sending again after a network error never records twice. Entries are also kept on the
 * device until the server confirms, so closing the app or losing signal loses nothing; reopening
 * the same job restores them with the same client event id. Nothing here reads the location. */
export function ServiceForm({ membership, job, adhoc, onBack, onAddEquipment, onOpenLocation, onDone }: {
  membership: Membership; job?: Job; adhoc?: { customerId: string; locationId: string };
  onBack: () => void; onAddEquipment: (locationId: string) => void; onOpenLocation: () => void; onDone: (result: ServiceResult) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const language = useContext(LanguageContext);
  const equipmentTitle = useEquipmentTitle();
  const org = membership.organization_id;
  const locationId = job?.location_id ?? adhoc!.locationId;
  const draftKey = `${draftPrefix(membership)}${job ? job.id : `adhoc:${locationId}`}`;
  const legacyKey = legacyDraftKey(org, job?.id, locationId);
  const clientEventId = useRef(uuid());
  const occurredAt = useRef(new Date().toISOString());
  const [restored, setRestored] = useState<boolean | null>(null);
  const [draftSaved, setDraftSaved] = useState<boolean | null>(null);
  const [units, setUnits] = useState<EquipmentSummary[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState(job ? [job.customer_name, job.location_label].filter(Boolean).join(' · ') : '');
  const draftsNow = useRef(drafts); draftsNow.current = drafts;
  // The job as last seen: a form opened without signal starts it only when the record is sent.
  const jobNow = useRef(job);
  // Photo uploads run one at a time; a photo already sent answers from sentIds, so the timer and a
  // fresh photo never upload the same file twice.
  const uploads = useRef<Promise<unknown>>(Promise.resolve());
  const sentIds = useRef(new Map<string, string>());

  const fresh = (): Draft => ({ service_type: job && serviceTypes.includes(job.job_type as never) ? job.job_type : 'maintenance', outcome: 'done',
    work_note: '', problem_note: '', not_done_reason: '', before: [], after: [], next: 'keep' });
  const reload = () => api.equipmentList(org, locationId).then(r => {
    setUnits(r.items);
    setDrafts(prev => {
      if (Object.keys(prev).length || !job) return prev;
      return Object.fromEntries(job.equipment.map(e => [e.id, fresh()]));
    });
  }, e => setFailure(errorText(e)));
  useEffect(() => {
    if (!adhoc) return;
    api.customer(org, adhoc.customerId).then(c => setTitle([customerTitle(c), c.locations.find(l => l.id === locationId)?.label].filter(Boolean).join(' · ')), () => {});
  }, []);
  useEffect(() => {
    void (async () => {
      let saved = await loadDraft<SavedForm>(draftKey);
      if (!saved) {
        const legacy = await loadDraft<SavedForm>(legacyKey);
        if (legacy && !legacy.memberId) { saved = legacy; await saveDraft<SavedForm>(draftKey, { ...legacy, memberId: membership.member_id }); await clearDraft(legacyKey); }
      }
      if (saved && (Object.keys(saved.drafts).length || saved.note)) {
        clientEventId.current = saved.clientEventId; occurredAt.current = saved.occurredAt;
        setDrafts(saved.drafts); setNote(saved.note); setRestored(true);
      } else setRestored(false);
      await reload();
    })();
  }, [locationId]);
  // Keep the device copy current (uploaded photo ids included) while the form is open.
  useEffect(() => {
    if (restored === null) return;
    let cancelled = false;
    setDraftSaved(null);
    if (!Object.keys(drafts).length && !note) { void clearDraft(draftKey); return; }
    const target: DraftTarget = { jobId: job?.id, customerId: job?.customer_id ?? adhoc!.customerId, locationId, title };
    void saveDraft<SavedForm>(draftKey, { clientEventId: clientEventId.current, occurredAt: occurredAt.current, drafts, note, target, memberId: membership.member_id })
      .then(saved => { if (!cancelled) setDraftSaved(saved); });
    return () => { cancelled = true; };
  }, [drafts, note, restored, title]);

  async function leaveWithDraft(next: () => void) {
    const target: DraftTarget = { jobId: job?.id, customerId: job?.customer_id ?? adhoc!.customerId, locationId, title };
    const saved = await saveDraft<SavedForm>(draftKey, { clientEventId: clientEventId.current, occurredAt: occurredAt.current, drafts: draftsNow.current, note, target, memberId: membership.member_id });
    setDraftSaved(saved);
    if (saved) next();
  }

  const toggle = (id: string) => setDrafts(prev => {
    const next = { ...prev };
    if (next[id]) { [...next[id]!.before, ...next[id]!.after].forEach(p => { if (p.local) dropKeptPhoto(p.local); }); delete next[id]; } else next[id] = fresh();
    return next;
  });
  const update = (id: string, patch: Partial<Draft>) => setDrafts(prev => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));
  /** Applies a change to the photo with this key wherever it is; null removes it. */
  const changePhoto = (key: string, change: (p: Photo) => Photo | null) => setDrafts(prev => Object.fromEntries(Object.entries(prev).map(([id, d]) => [id, {
    ...d, before: d.before.map(p => p.key === key ? change(p) : p).filter((p): p is Photo => p !== null),
    after: d.after.map(p => p.key === key ? change(p) : p).filter((p): p is Photo => p !== null),
  }])));

  /** Sends one waiting photo. A failure other than no signal drops it: it would never be accepted. */
  function sendPhoto(photo: Photo): Promise<string | 'offline' | null> {
    const key = photo.key!;
    const next = uploads.current.then(async () => {
      const done = sentIds.current.get(key);
      if (done) return done;
      try {
        const media = await uploadPhoto(org, { uri: photo.local!, mimeType: photo.mime ?? 'image/jpeg' }, 'service', key);
        sentIds.current.set(key, media.id);
        changePhoto(key, () => ({ id: media.id, thumb: media.thumbnail_url }));
        dropKeptPhoto(photo.local!);
        return media.id;
      } catch (e) {
        if (e instanceof ApiFailure && e.code === 'NETWORK_ERROR') return 'offline' as const;
        changePhoto(key, () => null); dropKeptPhoto(photo.local!);
        setFailure(e instanceof ApiFailure ? errorText(e) : t('uploadFailed'));
        return null;
      }
    });
    uploads.current = next.catch(() => {});
    return next;
  }

  /** Sends every waiting photo in turn, stopping at the first one without signal. Returns the ids
   * the server gave, or null while some are still waiting. */
  async function flushPhotos(): Promise<Record<string, string> | null> {
    const sent: Record<string, string> = {};
    for (const photo of allPhotos(draftsNow.current).filter(p => !p.id && p.key && p.local)) {
      const result = await sendPhoto(photo);
      if (result === 'offline') return null;
      if (result) sent[photo.key!] = result;
    }
    return sent;
  }
  const waiting = allPhotos(drafts).filter(p => !p.id).length;
  // Waiting photos go out by themselves when the app comes back to the front, and every 20 s.
  useEffect(() => {
    if (!waiting) return;
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void flushPhotos(); });
    const timer = setInterval(() => { void flushPhotos(); }, 20_000);
    return () => { sub.remove(); clearInterval(timer); };
  }, [waiting > 0]);

  async function addPhoto(id: string, kind: 'before' | 'after') {
    setFailure(null); setNotice(null);
    try {
      const picked = await pickPhoto('camera').catch(async e => { if (e instanceof CameraDeniedError) return pickPhoto('library'); throw e; });
      if (!picked) return;
      const key = uuid();
      const kept = await keepPhoto(picked, key);
      const photo: Photo = { id: null, thumb: null, key, local: kept.uri, mime: kept.mimeType };
      setDrafts(prev => prev[id] ? { ...prev, [id]: { ...prev[id]!, [kind]: [...prev[id]![kind], photo] } } : prev);
      setUploading(`${id}:${kind}`);
      if (await sendPhoto(photo) === 'offline') setNotice(t('photoQueued'));
    } catch { setFailure(t('uploadFailed')); } finally { setUploading(null); }
  }

  async function submit() {
    const ids = Object.keys(drafts);
    if (!ids.length) { setFailure(t('selectAtLeastOne')); return; }
    if (!ids.some(id => drafts[id]!.outcome === 'done')) { setFailure(t('field.noneDone')); return; }
    if (ids.some(id => drafts[id]!.outcome !== 'done' && !drafts[id]!.not_done_reason.trim())) { setFailure(t('notDoneReason')); return; }
    setBusy(true); setFailure(null); setNotice(null);
    const sent = await flushPhotos();
    if (!sent) { setBusy(false); setFailure(t('unsentHint')); return; }
    const current = draftsNow.current;
    const photoId = (p: Photo) => p.id ?? (p.key ? sent[p.key] : undefined);
    if (allPhotos(current).some(p => !photoId(p))) { setBusy(false); setFailure(t('unsentHint')); return; }
    const items: ServiceItemInput[] = Object.keys(current).map(id => {
      const d = current[id]!;
      const next: NextMaintenance | undefined = d.outcome !== 'done' || d.next === 'keep' ? undefined : d.next === 'none' ? { mode: 'none' } : { mode: 'months', interval_months: d.next };
      return { equipment_id: id, service_type: d.service_type, outcome: d.outcome, work_note: d.work_note.trim() || undefined, problem_note: d.problem_note.trim() || undefined,
        not_done_reason: d.outcome === 'done' ? undefined : d.not_done_reason.trim(),
        photos: [...d.before.map(p => ({ media_asset_id: photoId(p)!, photo_type: 'before' as const })), ...d.after.map(p => ({ media_asset_id: photoId(p)!, photo_type: 'after' as const }))],
        ...(next ? { next_maintenance: next } : {}) };
    });
    const body = { client_event_id: clientEventId.current, occurred_at: occurredAt.current, note: note.trim() || undefined, items };
    try {
      let planned = jobNow.current;
      if (planned?.status === 'scheduled') {
        const started = await api.jobAction(org, planned.id, 'start', { expected_version: planned.version });
        planned = jobNow.current = 'job' in started ? started.job : started;
      }
      const result = planned ? await api.completeJob(org, planned.id, { ...body, expected_version: planned.version })
        : await api.recordAdhoc(org, { ...body, customer_id: adhoc!.customerId, location_id: locationId });
      await clearDraft(draftKey);
      onDone(result);
    } catch (e) {
      setFailure(e instanceof ApiFailure && e.code === 'NETWORK_ERROR' ? t('unsentHint') : errorText(e));
    } finally { setBusy(false); }
  }

  if (!units || restored === null) return failure ? <Screen onBack={onBack}><Banner text={failure} /></Screen> : <Loading />;
  const today = todayBangkok();
  return <Screen onBack={onBack} footer={<>
    {waiting ? <Sub>{t('photosWaiting', { n: waiting })}</Sub> : null}
    {waiting ? <Button small kind="ghost" icon="cloud-upload-outline" title={t('retryPhotos')} busy={busy || uploading !== null} onPress={() => { void flushPhotos(); }} /> : null}
    <Button icon="checkmark-done" title={job ? t('finishJob') : t('recordService')} busy={busy} disabled={waiting > 0 || uploading !== null} onPress={submit} />
  </>}>
    <Title>{job ? t('recordService') : t('recordAdhoc')}</Title>
    <Button kind="secondary" icon="location-outline" title={t('ownerWeb.location_coordinates')} disabled={busy || uploading !== null || restored === null} onPress={() => { void leaveWithDraft(onOpenLocation); }} />
    {title ? <Sub>{title}</Sub> : null}
    {job ? null : <Sub>{t('adhocHint')}</Sub>}
    {restored ? <Banner tone="info" text={t('draftRestored')} /> : null}
    <Section action={<Button small kind="ghost" icon="add" title={t('addEquipment')} disabled={busy || uploading !== null || restored === null} onPress={() => { void leaveWithDraft(() => onAddEquipment(locationId)); }} />}>{t('selectEquipment')}</Section>
    {units.map(unit => {
      const d = drafts[unit.id];
      const [icon, tone] = categoryIcon(unit.category);
      return <Card key={unit.id}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: !!d }} onPress={() => toggle(unit.id)} style={styles.unitHead}>
          {unit.thumbnail_url ? <Image source={{ uri: unit.thumbnail_url }} style={styles.thumb} /> : <IconTile icon={icon} tone={tone} />}
          <View style={{ flex: 1 }}><Strong>{equipmentTitle(unit)}</Strong>{unit.serial_number ? <Sub>S/N {unit.serial_number}</Sub> : null}</View>
          <Icon name={d ? 'checkbox' : 'square-outline'} size={24} color={d ? colors.primary : colors.faint} />
        </Pressable>
        {d ? <View style={styles.unitBody}>
          <Text style={styles.label}>{t('outcome')}</Text>
          <View style={styles.chips}>{(['done', 'not_done', 'deferred'] as const).map(o => <Chip key={o} label={t(`outcome.${o}`)} on={d.outcome === o}
            onPress={() => update(unit.id, { outcome: o })} />)}</View>
          {d.outcome !== 'done' ? <Field required label={t('notDoneReason')} value={d.not_done_reason} onChangeText={v => update(unit.id, { not_done_reason: v })} error={failure && !d.not_done_reason.trim() ? t('field.required') : undefined} maxLength={500} /> : null}
          <View style={styles.photos}>
            {(['before', 'after'] as const).map(kind => <View key={kind} style={{ flex: 1 }}>
              <Text style={styles.label}>{t(kind === 'before' ? 'beforePhoto' : 'afterPhoto')}</Text>
              <View style={styles.thumbs}>
                {d[kind].map(p => <View key={p.id ?? p.key}>
                  {p.thumb || p.local ? <Image source={{ uri: (p.thumb ?? p.local)! }} style={styles.thumb} /> : <IconTile icon="image" tone="sky" />}
                  {p.id ? null : <View style={styles.waiting}><Icon name="cloud-upload" size={14} color={colors.onPrimary} /></View>}
                </View>)}
                <Pressable accessibilityRole="button" accessibilityLabel={t('takePhoto')} onPress={() => addPhoto(unit.id, kind)} style={styles.addPhoto}>
                  <Icon name={uploading === `${unit.id}:${kind}` ? 'hourglass' : 'camera'} size={20} color={colors.primary} />
                </Pressable>
              </View>
            </View>)}
          </View>
          <Disclosure title={`${t(`jobType.${d.service_type}` as TranslationKey)} · ${t('serviceDetails')}`}>
            <Text style={styles.label}>{t('serviceType')}</Text>
            <View style={styles.chips}>{serviceTypes.map(s => <Chip key={s} label={t(`jobType.${s}` as TranslationKey)} on={d.service_type === s} onPress={() => update(unit.id, { service_type: s })} />)}</View>
            <Field label={t('problemNote')} value={d.problem_note} onChangeText={v => update(unit.id, { problem_note: v })} multiline maxLength={2000} />
            {d.outcome === 'done' ? <Field label={t('workNote')} value={d.work_note} onChangeText={v => update(unit.id, { work_note: v })} multiline maxLength={2000} /> : null}
            {d.outcome === 'done' ? <>
            <Text style={styles.label}>{t('nextMaintenance')}</Text>
            <View style={styles.chips}>
              {(['keep', 3, 6, 12, 'none'] as const).map(n => <Chip key={String(n)} on={d.next === n} onPress={() => update(unit.id, { next: n })}
                label={n === 'keep' ? t('keepSchedule') : n === 'none' ? t('noReminder') : t('months', { n })} />)}
            </View>
            {typeof d.next === 'number' ? <Sub>{t('nextDue', { date: formatDate(new Date(`${addMonths(today, d.next)}T12:00:00+07:00`), language) })}</Sub> : null}
            </> : null}
          </Disclosure>
        </View> : null}
      </Card>;
    })}
    <Disclosure title={t('serviceNote')}><Field label={t('serviceNote')} value={note} onChangeText={setNote} multiline maxLength={2000} /></Disclosure>
    {draftSaved === true ? <Sub>{t('draftOnDevice')}</Sub> : null}
    {draftSaved === false ? <Banner text={t('draftSaveFailed')} /> : null}
    <Banner tone="info" text={notice} />
    <Banner text={failure} />
    <Text style={styles.hint}>{formatDateTime(new Date(occurredAt.current), language)}</Text>
  </Screen>;
}

/** Home reminder: service records kept on this phone that were not sent yet. */
export function UnsentRecords({ membership, onOpen }: { membership: Membership; onOpen: (target: DraftTarget) => void }) {
  const t = useT();
  const language = useContext(LanguageContext);
  const [items, setItems] = useState<{ key: string; savedAt: number; value: SavedForm }[]>([]);
  useEffect(() => {
    // This member's drafts, plus older drafts that have no owner yet.
    listDrafts<SavedForm>(`service:${membership.organization_id}:`)
      .then(list => setItems(list.filter(d => d.value.target && Object.keys(d.value.drafts ?? {}).length
        && (d.value.memberId ? d.value.memberId === membership.member_id && d.key.startsWith(draftPrefix(membership)) : !d.key.includes(':m:')))), () => {});
  }, [membership.organization_id, membership.member_id]);
  if (!items.length) return null;
  return <><Section>{t('unsentRecords')}</Section>
    <Card padded={false}>{items.map((d, i) => <Row key={d.key} icon="cloud-upload" tone="amber" last={i === items.length - 1}
      title={d.value.target!.title || t('recordAdhoc')} subtitle={`${formatDateTime(new Date(d.savedAt), language)} · ${t('unsentRecordsHint')}`}
      onPress={() => onOpen(d.value.target!)} />)}</Card></>;
}

export function ServiceDone({ result, onDone }: { result: ServiceResult; onDone: () => void }) {
  const t = useT();
  const language = useContext(LanguageContext);
  return <Screen footer={<Button icon="home" title={t('done')} onPress={onDone} />}>
    <IconTile icon="checkmark-circle" tone="green" size={64} />
    <Title>{result.job_status === 'completed' ? t('jobFinished') : t('serviceSaved')}</Title>
    <Card>{result.items.map((i, index) => <View key={index} style={styles.resultRow}>
      <Badge text={t(`outcome.${i.outcome}` as TranslationKey)} tone={outcomeTone(i.outcome)} />
      {i.next_due_on ? <Sub>{t('nextDue', { date: formatDate(new Date(`${i.next_due_on}T12:00:00+07:00`), language) })}</Sub> : null}
    </View>)}</Card>
  </Screen>;
}

/** Service history of one unit, newest first, with who did it and the next due date. */
export function EquipmentHistoryView({ membership, equipmentId }: { membership: Membership; equipmentId: string }) {
  const t = useT();
  const language = useContext(LanguageContext);
  const [history, setHistory] = useState<EquipmentHistory | null>(null);
  useEffect(() => { api.equipmentHistory(membership.organization_id, equipmentId).then(setHistory, () => setHistory({ items: [], maintenance: [] })); }, [equipmentId]);
  if (!history) return <Loading />;
  const due = history.maintenance.filter(m => m.enabled && m.due_date);
  return <>
    {due.map(m => <Banner key={m.service_type} tone="info" text={`${t(`jobType.${m.service_type}` as TranslationKey)} · ${t('maintenanceDue', { date: formatDate(new Date(`${m.due_date}T12:00:00+07:00`), language) })}`} />)}
    <Section>{t('serviceHistory')}</Section>
    {history.items.length === 0 ? <Card><Sub>{t('noHistory')}</Sub></Card> : <Card>
      {history.items.map(i => <View key={i.id} style={styles.historyRow}>
        <View style={styles.historyHead}>
          <Strong>{t(`jobType.${i.service_type}` as TranslationKey)}</Strong>
          <Badge text={t(`outcome.${i.outcome}` as TranslationKey)} tone={outcomeTone(i.outcome)} />
        </View>
        <Sub>{[formatDate(new Date(i.occurred_at), language), i.performed_by_name ? t('performedBy', { name: i.performed_by_name }) : null].filter(Boolean).join(' · ')}</Sub>
        {i.problem_note ? <Text style={styles.note}>{i.problem_note}</Text> : null}
        {i.work_note ? <Text style={styles.note}>{i.work_note}</Text> : null}
        {i.not_done_reason ? <Text style={styles.note}>{i.not_done_reason}</Text> : null}
        {i.photos.length ? <View style={styles.thumbs}>{i.photos.map((p, n) => p.thumbnail_url ? <Image key={n} source={{ uri: p.thumbnail_url }} style={styles.thumb} /> : null)}</View> : null}
      </View>)}
    </Card>}
  </>;
}

const styles = StyleSheet.create({
  unitHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  unitBody: { marginTop: 8 },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.muted, marginTop: 12, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  chipText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.ink },
  photos: { flexDirection: 'row', gap: 12 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  thumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: colors.line },
  waiting: { position: 'absolute', right: 3, bottom: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.warn, alignItems: 'center', justifyContent: 'center' },
  addPhoto: { width: 56, height: 56, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.faint, marginTop: 8 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  historyRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 4 },
  historyHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.ink },
});
