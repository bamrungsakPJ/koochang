import { useContext, useEffect, useRef, useState } from 'react';
import { AppState, Image, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { formatDate, formatDateTime, type TranslationKey } from '@field-service/i18n';
import { api, ApiFailure, type EquipmentHistory, type EquipmentSummary, type Job, type Membership, type NextMaintenance, type ServiceItemInput, type ServiceResult } from '../api';
import { CameraDeniedError, dropKeptPhoto, keepPhoto, pickPhoto, uploadPhoto, uuid } from '../photos';
import { clearDraft, listDrafts, loadDraft, saveDraft } from '../drafts';
import { Badge, Banner, Button, Card, colors, confirm, Disclosure, Field, fonts, Icon, IconTile, LanguageContext, Loading, Row, Screen, Section, Strong, Sub, Title, useErrorText, useT } from '../ui';
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

/** Tap-to-add phrases for the notes (Thai technicians would rather tap than type). Air conditioners
 * get their own; other equipment gets general ones. The phrase goes into the note as plain text. */
const quickNotes: Record<'work' | 'problem', Record<string, TranslationKey[]>> = {
  work: { air_conditioner: ['quick.cleanCoil', 'quick.refill', 'quick.drainTray'], other: ['quick.cleaned', 'quick.replacedPart', 'quick.generalCheck'] },
  problem: { air_conditioner: ['quick.dirtyCoil', 'quick.lowGas', 'quick.blockedDrain', 'quick.noisy'], other: ['quick.noisy', 'quick.leaking', 'quick.damaged'] },
};
const notePhrases = (note: string) => note.split(/,\s*/).map(p => p.trim()).filter(Boolean);
/** Adds the phrase to the note, or takes it out again when it is already there. */
const togglePhrase = (note: string, phrase: string) => {
  const parts = notePhrases(note);
  return (parts.includes(phrase) ? parts.filter(p => p !== phrase) : [...parts, phrase]).join(', ');
};

/** What the done screen needs to show and share: unit names and the note per unit. */
export interface ServiceSummary { place: string; units: Record<string, string>; notes: Record<string, string> }

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
  onBack: () => void; onAddEquipment: (locationId: string) => void; onOpenLocation: () => void; onDone: (result: ServiceResult, summary: ServiceSummary) => void;
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
  const [open, setOpen] = useState<Record<string, boolean>>({});
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

  /** The outcome choice also includes "skip": the unit is left out of this record. Leaving a unit
   * out that already has photos asks first, because its photos are dropped. */
  async function choose(id: string, outcome: Draft['outcome'] | 'skip') {
    const current = draftsNow.current[id];
    if (outcome === 'skip') {
      if (!current) return;
      const photos = [...current.before, ...current.after];
      if (photos.length && !await confirm(t('removeUnitPhotos'), t('outcome.skip'), t('cancel'))) return;
      photos.forEach(p => { if (p.local) dropKeptPhoto(p.local); });
      setDrafts(prev => { const next = { ...prev }; delete next[id]; return next; });
      return;
    }
    setDrafts(prev => ({ ...prev, [id]: { ...(prev[id] ?? fresh()), outcome } }));
  }
  const allDone = () => setDrafts(prev => Object.fromEntries(units!.map(u => [u.id, { ...(prev[u.id] ?? fresh()), outcome: 'done' as const }])));
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

  /** Takes one photo for a unit. In a run the camera opens again for the next unit at once, so
   * the upload is not awaited there (uploads still go one at a time). False when cancelled. */
  async function addPhoto(id: string, kind: 'before' | 'after', run = false): Promise<boolean> {
    setFailure(null); setNotice(null);
    try {
      const picked = await pickPhoto('camera').catch(async e => { if (e instanceof CameraDeniedError) return pickPhoto('library'); throw e; });
      if (!picked) return false;
      const key = uuid();
      const kept = await keepPhoto(picked, key);
      const photo: Photo = { id: null, thumb: null, key, local: kept.uri, mime: kept.mimeType };
      setDrafts(prev => prev[id] ? { ...prev, [id]: { ...prev[id]!, [kind]: [...prev[id]![kind], photo] } } : prev);
      const sending = sendPhoto(photo).then(r => { if (r === 'offline') setNotice(t('photoQueued')); });
      if (!run) { setUploading(`${id}:${kind}`); await sending; }
      return true;
    } catch { setFailure(t('uploadFailed')); return false; } finally { if (!run) setUploading(null); }
  }
  /** Before (or after) photos for every chosen unit in a row: the camera opens for each unit that
   * has none yet, in list order, and stops when the technician cancels. */
  async function photoRun(kind: 'before' | 'after') {
    const ids = units!.filter(u => draftsNow.current[u.id] && !draftsNow.current[u.id]![kind].length).map(u => u.id);
    setUploading(`run:${kind}`);
    try { for (const id of ids) if (!await addPhoto(id, kind, true)) break; } finally { setUploading(null); }
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
      onDone(result, { place: title, units: Object.fromEntries(units!.map(u => [u.id, equipmentTitle(u)])),
        notes: Object.fromEntries(Object.entries(current).map(([id, d]) => [id, d.outcome === 'done' ? d.work_note.trim() : d.not_done_reason.trim()])) });
    } catch (e) {
      setFailure(e instanceof ApiFailure && e.code === 'NETWORK_ERROR' ? t('unsentHint') : errorText(e));
    } finally { setBusy(false); }
  }

  if (!units || restored === null) return failure ? <Screen onBack={onBack} title={job ? t('recordService') : t('recordAdhoc')}><Banner text={failure} /></Screen> : <Loading />;
  const today = todayBangkok();
  const chosen = units.filter(u => drafts[u.id]);
  const busyNow = busy || uploading !== null || restored === null;
  const run = (kind: 'before' | 'after') => {
    const done = chosen.filter(u => drafts[u.id]![kind].length).length;
    const next = chosen.find(u => !drafts[u.id]![kind].length);
    return <Pressable accessibilityRole="button" disabled={busyNow || !next} onPress={() => { void photoRun(kind); }}
      style={({ pressed }) => [styles.shot, !next && styles.shotDone, pressed && { backgroundColor: colors.primarySoft }]}>
      <View style={styles.shotHead}><Icon name={uploading === `run:${kind}` ? 'hourglass' : next ? 'camera' : 'checkmark-done'} size={20} color={next ? colors.primary : colors.success} />
        <Text style={styles.shotCount}>{done}/{chosen.length}</Text></View>
      <Text style={styles.shotTitle}>{t(kind === 'before' ? 'beforePhoto' : 'afterPhoto')}</Text>
      <Text style={[styles.shotSub, !next && { color: colors.success }]} numberOfLines={1}>{next ? t('photoNext', { name: equipmentTitle(next) }) : t('photoAllDone')}</Text>
    </Pressable>;
  };
  const chips = (unitId: string, category: string, field: 'work_note' | 'problem_note') => {
    const d = drafts[unitId]!;
    const list = quickNotes[field === 'work_note' ? 'work' : 'problem'][category === 'air_conditioner' ? 'air_conditioner' : 'other']!;
    const parts = notePhrases(d[field]);
    return <View style={styles.chips}>{list.map(key => { const phrase = t(key); const on = parts.includes(phrase);
      return <Pressable key={key} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => update(unitId, { [field]: togglePhrase(d[field], phrase) })}
        style={[styles.quick, on && styles.quickOn]}><Text style={[styles.quickText, on && { color: colors.onPrimary }]}>{phrase}</Text></Pressable>; })}</View>;
  };
  return <Screen onBack={onBack} title={job ? t('recordService') : t('recordAdhoc')} subtitle={title || undefined} footer={<>
    {waiting ? <Sub>{t('photosWaiting', { n: waiting })}</Sub> : draftSaved === true ? <Sub>{t('draftOnDevice')}</Sub> : null}
    {waiting ? <Button small kind="ghost" icon="cloud-upload-outline" title={t('retryPhotos')} busy={busy || uploading !== null} onPress={() => { void flushPhotos(); }} /> : null}
    <Button icon="checkmark-done" title={`${job ? t('finishJob') : t('recordService')} · ${t('equipmentCount', { count: chosen.length })}`} busy={busy} disabled={waiting > 0 || uploading !== null} onPress={submit} />
  </>}>
    <Card padded={false}><Row icon="location-outline" tone="sky" title={t('ownerWeb.location_coordinates')}
      subtitle={job ? (job.latitude !== null ? t('hasCoordinates') : t('noCoordinates')) : undefined} onPress={busyNow ? undefined : () => { void leaveWithDraft(onOpenLocation); }} last /></Card>
    {job ? null : <Sub>{t('adhocHint')}</Sub>}
    {restored ? <Banner tone="info" text={t('draftRestored')} /> : null}
    {chosen.length > 1 ? <Card>
      <Strong>{t('photoRun')}</Strong><Sub>{t('photoRunHint')}</Sub>
      <View style={styles.shots}>{run('before')}{run('after')}</View>
    </Card> : null}
    <Section action={<Button small kind="tonal" icon="add" title={t('addEquipment')} disabled={busyNow} onPress={() => { void leaveWithDraft(() => onAddEquipment(locationId)); }} />}>{t('selectEquipment')}</Section>
    {units.length > 1 ? <View style={styles.bulk}><Sub>{t('selectedOf', { n: chosen.length, total: units.length })}</Sub>
      <Button small kind="tonal" icon="checkmark-done" title={t('allDone')} disabled={busyNow} onPress={allDone} /></View> : null}
    {units.map(unit => {
      const d = drafts[unit.id];
      const [icon, tone] = categoryIcon(unit.category);
      // A single unit opens by itself: its photo slots are the way to take photos then.
      const expanded = !!d && (open[unit.id] ?? units.length === 1);
      const shots = d ? d.before.length + d.after.length : 0;
      return <Card key={unit.id}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded }} disabled={!d} onPress={() => setOpen(prev => ({ ...prev, [unit.id]: !expanded }))} style={styles.unitHead}>
          {unit.thumbnail_url ? <Image source={{ uri: unit.thumbnail_url }} style={styles.thumb} /> : <IconTile icon={icon} tone={tone} />}
          <View style={{ flex: 1 }}>
            <Strong>{equipmentTitle(unit)}</Strong>{unit.serial_number ? <Sub>S/N {unit.serial_number}</Sub> : null}
            <View style={styles.unitMeta}>
              {d ? <><Badge text={t(`outcome.${d.outcome}` as TranslationKey)} tone={outcomeTone(d.outcome)} /><Badge text={t('photoCount', { n: shots })} tone={d.before.length && d.after.length ? 'ok' : 'neutral'} /></>
                : <Badge text={t('notIncluded')} />}
            </View>
          </View>
          {d ? <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={colors.faint} /> : null}
        </Pressable>
        <View style={styles.segment}>{(['done', 'not_done', 'deferred', 'skip'] as const).map(o => {
          const on = (d?.outcome ?? 'skip') === o;
          return <Pressable key={o} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => { void choose(unit.id, o); }} style={[styles.segmentItem, on && styles.segmentOn]}>
            <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{t(`outcome.${o}` as TranslationKey)}</Text></Pressable>;
        })}</View>
        {d && d.outcome !== 'done' ? <Field required label={t('notDoneReason')} value={d.not_done_reason} onChangeText={v => update(unit.id, { not_done_reason: v })} error={failure && !d.not_done_reason.trim() ? t('field.required') : undefined} maxLength={500} /> : null}
        {expanded && d ? <View style={styles.unitBody}>
          <View style={styles.photos}>
            {(['before', 'after'] as const).map(kind => <View key={kind} style={{ flex: 1 }}>
              <Text style={styles.label}>{t(kind === 'before' ? 'beforePhoto' : 'afterPhoto')}</Text>
              <View style={styles.thumbs}>
                {d[kind].map(p => <View key={p.id ?? p.key}>
                  {p.thumb || p.local ? <Image source={{ uri: (p.thumb ?? p.local)! }} style={styles.thumb} /> : <IconTile icon="image" tone="sky" />}
                  {p.id ? null : <View style={styles.waiting}><Icon name="cloud-upload" size={14} color={colors.onPrimary} /></View>}
                </View>)}
                <Pressable accessibilityRole="button" accessibilityLabel={t('takePhoto')} disabled={busyNow} onPress={() => { void addPhoto(unit.id, kind); }} style={styles.addPhoto}>
                  <Icon name={uploading === `${unit.id}:${kind}` ? 'hourglass' : 'camera'} size={20} color={colors.primary} />
                </Pressable>
              </View>
            </View>)}
          </View>
          {d.outcome === 'done' ? <>
            <Text style={styles.label}>{t('workNote')} · {t('quickPick')}</Text>
            {chips(unit.id, unit.category, 'work_note')}
            <Field label={t('workNote')} value={d.work_note} onChangeText={v => update(unit.id, { work_note: v })} multiline maxLength={2000} />
          </> : null}
          <Text style={styles.label}>{t('problemNote')} · {t('quickPick')}</Text>
          {chips(unit.id, unit.category, 'problem_note')}
          <Field label={t('problemNote')} value={d.problem_note} onChangeText={v => update(unit.id, { problem_note: v })} multiline maxLength={2000} />
          <View style={styles.mic}><Icon name="mic-outline" size={16} color={colors.muted} /><Text style={styles.micText}>{t('micHint')}</Text></View>
          <Disclosure title={`${t(`jobType.${d.service_type}` as TranslationKey)} · ${t('serviceDetails')}`}>
            <Text style={styles.label}>{t('serviceType')}</Text>
            <View style={styles.chips}>{serviceTypes.map(st => <Chip key={st} label={t(`jobType.${st}` as TranslationKey)} on={d.service_type === st} onPress={() => update(unit.id, { service_type: st })} />)}</View>
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

/** Result of the record, with a text summary the technician can send to the customer through
 * their chat app (Android share sheet; photos are not attached in this version). */
export function ServiceDone({ result, summary, onDone }: { result: ServiceResult; summary?: ServiceSummary; onDone: () => void }) {
  const t = useT();
  const language = useContext(LanguageContext);
  const name = (id: string) => summary?.units[id] ?? '';
  function share() {
    const lines = [t('summaryTitle'), summary?.place, formatDateTime(new Date(), language), '',
      ...result.items.map(i => `• ${name(i.equipment_id)}: ${t(`outcome.${i.outcome}` as TranslationKey)}${summary?.notes[i.equipment_id] ? ` (${summary.notes[i.equipment_id]})` : ''}${i.next_due_on ? ` · ${t('nextDue', { date: formatDate(new Date(`${i.next_due_on}T12:00:00+07:00`), language) })}` : ''}`)];
    void Share.share({ message: lines.filter(l => l !== undefined).join('\n') });
  }
  return <Screen footer={<Button icon="home" title={t('done')} onPress={onDone} />}>
    <IconTile icon="checkmark-circle" tone="green" size={64} />
    <Title>{result.job_status === 'completed' ? t('jobFinished') : t('serviceSaved')}</Title>
    {summary?.place ? <Sub>{summary.place}</Sub> : null}
    <Card>{result.items.map((i, index) => <View key={index} style={styles.resultRow}>
      <View style={{ flex: 1 }}>{name(i.equipment_id) ? <Strong>{name(i.equipment_id)}</Strong> : null}
        {i.next_due_on ? <Sub>{t('nextDue', { date: formatDate(new Date(`${i.next_due_on}T12:00:00+07:00`), language) })}</Sub> : null}</View>
      <Badge text={t(`outcome.${i.outcome}` as TranslationKey)} tone={outcomeTone(i.outcome)} />
    </View>)}</Card>
    <Card>
      <Strong>{t('shareSummary')}</Strong><Sub>{t('shareSummaryHint')}</Sub>
      <Button kind="secondary" icon="share-social" title={t('shareSummary')} onPress={share} />
    </Card>
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
  unitMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  unitBody: { marginTop: 8 },
  segment: { flexDirection: 'row', gap: 4, backgroundColor: colors.tonal, borderRadius: 12, padding: 4, marginTop: 12 },
  segmentItem: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  segmentOn: { backgroundColor: colors.surface, elevation: 1, shadowColor: '#12243A', shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  segmentText: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22, color: colors.muted },
  segmentTextOn: { fontFamily: fonts.semibold, color: colors.ink },
  shots: { flexDirection: 'row', gap: 8, marginTop: 12 },
  shot: { flex: 1, minHeight: 80, borderRadius: 12, borderWidth: 1, borderColor: colors.faint, padding: 12, gap: 2, backgroundColor: colors.surface },
  shotDone: { borderColor: '#B7DEC3', backgroundColor: '#F3FAF5' },
  shotHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shotTitle: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, color: colors.ink, marginTop: 4 },
  shotCount: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24, color: colors.ink },
  shotSub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.muted },
  bulk: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  quick: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#B8C4D2', backgroundColor: colors.surface },
  quickOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  quickText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.ink },
  mic: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  micText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.muted },
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
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  historyRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 4 },
  historyHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  note: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.ink },
});
