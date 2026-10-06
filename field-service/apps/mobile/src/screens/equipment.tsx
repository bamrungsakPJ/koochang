import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { TranslationKey } from '@field-service/i18n';
import { api, ApiFailure, type Equipment, type EquipmentSummary, type Media, type Membership } from '../api';
import { CameraDeniedError, pickPhoto, uploadPhoto, uuid, type Picked } from '../photos';
import { EquipmentHistoryView } from './service';
import { Banner, Button, Card, colors, Field, fonts, Icon, IconTile, Loading, Row, Screen, Section, Strong, Sub, Title, useErrorText, useT, type IconName, type Tone } from '../ui';

export const categories = ['air_conditioner', 'water_filter', 'cctv', 'solar', 'pump', 'refrigeration', 'other'] as const;
const categoryLook: Record<string, [IconName, Tone]> = {
  air_conditioner: ['snow', 'sky'], water_filter: ['water', 'teal'], cctv: ['videocam', 'violet'], solar: ['sunny', 'amber'],
  pump: ['speedometer', 'blue'], refrigeration: ['thermometer', 'teal'], other: ['construct', 'rose'],
};
export const categoryIcon = (category: string) => categoryLook[category] ?? categoryLook.other!;

/** Display name: nickname, else category + brand/model. */
export function useEquipmentTitle() {
  const t = useT();
  return (e: Pick<EquipmentSummary, 'name' | 'category' | 'brand' | 'model'>) =>
    e.name?.trim() || [t(`category.${categories.includes(e.category as never) ? e.category : 'other'}` as TranslationKey), e.brand, e.model].filter(Boolean).join(' ');
}

type PhotoState = { state: 'empty' } | { state: 'uploading'; uri?: string } | { state: 'ready'; media: Media; uri?: string } | { state: 'error'; message: string; uri?: string };
type Ocr = { state: 'submitting' } | { state: 'none' } | { state: 'reading'; id: string } | { state: 'done'; id: string; fields: Record<string, string> } | { state: 'empty'; id: string } | { state: 'failed'; id?: string; message: string; terminal?: boolean } | { state: 'waiting'; id: string };

/** Choose camera / library / skip for one photo slot. */
function PhotoSlot({ title, hint, photo, onPick, onRetry, children }: { children?: React.ReactNode; title: string; hint?: string; photo: PhotoState; onPick: (source: 'camera' | 'library') => void; onRetry?: () => void }) {
  const t = useT();
  return <Card>
    <View style={styles.slotHead}>
      {('uri' in photo && photo.uri) || (photo.state === 'ready' && photo.media.thumbnail_url) ? <Image source={{ uri: ('uri' in photo ? photo.uri : undefined) || (photo.state === 'ready' ? photo.media.thumbnail_url! : '') }} style={styles.slotImage} />
        : <IconTile icon="camera" tone="sky" size={56} />}
      <View style={{ flex: 1 }}><Strong>{title}</Strong>{hint ? <Sub>{hint}</Sub> : null}</View>
    </View>
    {children}
    {photo.state === 'uploading' ? <Banner tone="info" text={t('uploading')} /> : null}
    {photo.state === 'error' ? <Banner tone="info" text={photo.message} /> : null}
    {photo.state !== 'uploading' ? <View style={styles.row}>
      <View style={{ flex: 1 }}><Button small icon="camera" title={t('takePhoto')} kind={photo.state === 'ready' ? 'secondary' : 'primary'} onPress={() => onPick('camera')} /></View>
      <View style={{ flex: 1 }}><Button small kind="secondary" icon="images" title={t('choosePhoto')} onPress={() => onPick('library')} /></View>
    </View> : null}
    {photo.state === 'error' && onRetry ? <Button small kind="ghost" icon="refresh" title={t('retry')} onPress={onRetry} /> : null}
  </Card>;
}

/** Camera first: nameplate → (OCR in the background) → equipment photo → fields. Nothing waits
 * for OCR; suggestions are shown next to the fields and used only when the person taps them. */
export function EquipmentForm({ membership, locationId, onBack, onDone, onOpenExisting }: {
  membership: Membership; locationId: string; onBack: () => void; onDone: () => void; onOpenExisting: (id: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const org = membership.organization_id;
  const [round, setRound] = useState(0);
  const key = useRef(uuid());
  const [nameplate, setNameplate] = useState<PhotoState>({ state: 'empty' });
  const [unitPhoto, setUnitPhoto] = useState<PhotoState>({ state: 'empty' });
  const [ocr, setOcr] = useState<Ocr>({ state: 'none' });
  const [category, setCategory] = useState<string>('air_conditioner');
  const [values, setValues] = useState({ name: '', brand: '', model: '', serial_number: '' });
  const [failure, setFailure] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<ApiFailure['candidates']>([]);
  const [saved, setSaved] = useState<Equipment | null>(null);
  const [busy, setBusy] = useState(false);

  const pendingPhotos = useRef<Partial<Record<'nameplate' | 'equipment', { picked: Picked; key: string }>>>({});
  const generation = useRef(0);
  const ocrKey = useRef({ mediaId: '', key: '' });
  useEffect(() => () => { generation.current++; }, []);

  useEffect(() => {
    if (ocr.state !== 'reading') return;
    const id = ocr.id;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    async function poll() {
      try {
        const r = await api.ocr(org, id);
        if (cancelled) return;
        if (r.status === 'succeeded') {
          const fields = Object.fromEntries(Object.entries(r.suggestions?.fields ?? {}).filter(([k, v]) => ['brand', 'model', 'serial_number'].includes(k) && typeof v === 'string' && v.trim())) as Record<string, string>;
          setOcr(Object.keys(fields).length ? { state: 'done', id, fields } : { state: 'empty', id });
          return;
        }
        if (r.status === 'failed' || r.status === 'cancelled') {
          setOcr({ state: 'failed', id, message: t('ocrFailed'), terminal: true });
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setOcr({ state: 'failed', id, message: errorText(e) });
        return;
      }
      if (Date.now() - started >= 180_000) { setOcr({ state: 'waiting', id }); return; }
      timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [ocr.state === 'reading' ? ocr.id : null, org]);

  async function startReading(media: Media, fresh = false) {
    const token = generation.current;
    if (fresh || ocrKey.current.mediaId !== media.id) ocrKey.current = { mediaId: media.id, key: uuid() };
    setOcr({ state: 'submitting' });
    try {
      const request = await api.requestOcr(org, media.id, ocrKey.current.key);
      if (token === generation.current) setOcr({ state: 'reading', id: request.id });
    } catch (e) {
      if (token === generation.current) setOcr({ state: 'failed', message: e instanceof ApiFailure && e.status === 503 ? t('ocrUnavailable') : errorText(e) });
    }
  }

  async function pick(slot: 'nameplate' | 'equipment', source: 'camera' | 'library') {
    const set = slot === 'nameplate' ? setNameplate : setUnitPhoto;
    let picked;
    try { picked = await pickPhoto(source); }
    catch (e) { set({ state: 'error', message: e instanceof CameraDeniedError ? t('cameraDenied') : t('uploadFailed') }); return; }
    if (!picked) return;
    pendingPhotos.current[slot] = { picked, key: uuid() };
    await sendPhoto(slot);
  }

  async function sendPhoto(slot: 'nameplate' | 'equipment') {
    const pending = pendingPhotos.current[slot];
    if (!pending) return;
    const set = slot === 'nameplate' ? setNameplate : setUnitPhoto;
    const { picked, key } = pending;
    const token = slot === 'nameplate' ? ++generation.current : generation.current;
    if (slot === 'nameplate') setOcr({ state: 'none' });
    set({ state: 'uploading', uri: picked.uri });
    try {
      const media = await uploadPhoto(org, picked, slot, key);
      if (pendingPhotos.current[slot] !== pending || (slot === 'nameplate' && token !== generation.current)) return;
      set({ state: 'ready', media, uri: picked.uri });
      if (slot === 'nameplate') await startReading(media);
    } catch (e) {
      if (pendingPhotos.current[slot] !== pending || (slot === 'nameplate' && token !== generation.current)) return;
      const contentError = e instanceof ApiFailure ? e.fieldErrors.content : undefined;
      const message = contentError === 'field.required' ? t('uploadNotReceived') : contentError === 'field.image' ? t('uploadInvalidImage')
        : e instanceof ApiFailure && e.status === 413 ? t('uploadTooLarge') : errorText(e);
      set({ state: 'error', message, uri: picked.uri });
    }
  }

  const suggestions = ocr.state === 'done' ? ocr.fields : {};
  function useSuggestion(field: keyof typeof values) { const v = suggestions[field]; if (v) setValues(prev => ({ ...prev, [field]: v })); }
  function useAll() { setValues(prev => ({ ...prev, ...Object.fromEntries((['brand', 'model', 'serial_number'] as const).filter(k => !prev[k] && suggestions[k]).map(k => [k, suggestions[k]!])) })); }

  async function save(confirmDuplicate = false) {
    setBusy(true); setFailure(null);
    try {
      const photos = [nameplate.state === 'ready' ? { media_asset_id: nameplate.media.id, photo_type: 'nameplate' } : null,
        unitPhoto.state === 'ready' ? { media_asset_id: unitPhoto.media.id, photo_type: 'equipment' } : null].filter((p): p is { media_asset_id: string; photo_type: string } => !!p);
      const result = await api.createEquipment(org, locationId, {
        request_key: key.current, category, name: values.name.trim() || null, brand: values.brand.trim() || null, model: values.model.trim() || null,
        serial_number: values.serial_number.trim() || null, photos, ocr_request_id: 'id' in ocr ? ocr.id : undefined, confirm_duplicate: confirmDuplicate || undefined,
      });
      setSaved(result); setDuplicates([]);
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'DUPLICATE_WARNING') setDuplicates(e.candidates);
      else setFailure(errorText(e));
    } finally { setBusy(false); }
  }
  function another() {
    pendingPhotos.current = {}; generation.current++; key.current = uuid(); setRound(round + 1); setSaved(null); setNameplate({ state: 'empty' }); setUnitPhoto({ state: 'empty' }); setOcr({ state: 'none' });
    setValues({ name: '', brand: '', model: '', serial_number: '' }); setDuplicates([]); setFailure(null);
  }
  const title = useEquipmentTitle();

  if (saved) return <Screen footer={<>
    <Button icon="add" title={t('addAnother')} onPress={another} />
    <Button kind="ghost" title={t('done')} onPress={onDone} />
  </>}>
    <IconTile icon="checkmark-circle" tone="green" size={64} />
    <Title>{t('equipmentSaved')}</Title>
    <Sub>{title(saved)}</Sub>
  </Screen>;

  const suggestionLine = (field: keyof typeof values) => suggestions[field] && suggestions[field] !== values[field]
    ? <Pressable accessibilityRole="button" onPress={() => useSuggestion(field)} style={styles.suggestion}>
        <Icon name="sparkles" size={16} color={colors.primary} />
        <Text style={styles.suggestionText}>{t('suggestion', { value: suggestions[field]! })}</Text>
        <Text style={styles.suggestionUse}>{t('useSuggestion')}</Text>
      </Pressable> : null;

  return <Screen key={round} onBack={onBack} footer={<Button title={t('saveEquipment')} icon="checkmark" busy={busy} disabled={nameplate.state === 'uploading' || unitPhoto.state === 'uploading'} onPress={() => save()} />}>
    <Title>{t('addEquipment')}</Title>
    <PhotoSlot title={t('nameplatePhoto')} hint={t('nameplateHint')} photo={nameplate} onPick={source => pick('nameplate', source)}
      onRetry={() => sendPhoto('nameplate')}>
      {ocr.state === 'submitting' || ocr.state === 'reading' ? <Banner tone="info" text={t(ocr.state === 'submitting' ? 'ocrSubmitting' : 'ocrReading')} /> : null}
      {ocr.state === 'done' ? <>
        <Banner tone="success" text={t('ocrDone')} />
        {(['brand', 'model', 'serial_number'] as const).map(field => <Sub key={field}>{t(field === 'serial_number' ? 'serial' : field)}: {ocr.fields[field] || t('ocrNotRead')}</Sub>)}
        <Button small kind="secondary" icon="sparkles" title={t('useAllSuggestions')} onPress={useAll} />
      </> : null}
      {ocr.state === 'empty' ? <Banner tone="info" text={t('ocrEmpty')} /> : null}
      {ocr.state === 'failed' ? <Banner tone="info" text={`${t('ocrFailed')} ${ocr.message}`} /> : null}
      {ocr.state === 'waiting' ? <Banner tone="info" text={t('ocrWaiting')} /> : null}
      {nameplate.state === 'ready' && ['failed', 'empty', 'waiting'].includes(ocr.state) ? <Button small kind="secondary" icon="refresh" title={t('ocrRetry')} onPress={() => {
        if (ocr.state === 'waiting' || (ocr.state === 'failed' && ocr.id && !ocr.terminal)) setOcr({ state: 'reading', id: ocr.id! });
        else void startReading(nameplate.media, ocr.state === 'empty' || (ocr.state === 'failed' && !!ocr.terminal));
      }} /> : null}
    </PhotoSlot>
    <PhotoSlot title={t('equipmentPhoto')} photo={unitPhoto} onPick={source => pick('equipment', source)} onRetry={() => sendPhoto('equipment')} />

    <Section>{t('category')}</Section>
    <View style={styles.chips}>
      {categories.map(c => {
        const [icon, tone] = categoryIcon(c);
        const on = c === category;
        return <Pressable key={c} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setCategory(c)} style={[styles.chip, on && styles.chipOn]}>
          <Icon name={icon} size={16} color={on ? colors.onPrimary : colors.muted} />
          <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(`category.${c}` as TranslationKey)}</Text>
        </Pressable>;
      })}
    </View>
    <Field label={t('equipmentName')} icon="pricetag-outline" value={values.name} onChangeText={v => setValues({ ...values, name: v })} hint={t('equipmentNameHint')} maxLength={80} />
    <Field label={t('brand')} value={values.brand} onChangeText={v => setValues({ ...values, brand: v })} maxLength={80} />
    {suggestionLine('brand')}
    <Field label={t('model')} value={values.model} onChangeText={v => setValues({ ...values, model: v })} autoCapitalize="characters" maxLength={80} />
    {suggestionLine('model')}
    <Field label={t('serial')} value={values.serial_number} onChangeText={v => setValues({ ...values, serial_number: v })} autoCapitalize="characters" autoCorrect={false} hint={t('serialHint')} maxLength={80} />
    {suggestionLine('serial_number')}
    <Banner text={failure} />
    {duplicates.length ? <Card>
      <Strong>{t('duplicateEquipmentTitle')}</Strong>
      <Sub>{t('duplicateEquipmentBody')}</Sub>
      {duplicates.map(d => <Row key={d.id} icon={categoryIcon((d as unknown as EquipmentSummary).category)[0]} tone={categoryIcon((d as unknown as EquipmentSummary).category)[1]}
        title={title(d as unknown as EquipmentSummary)} subtitle={(d as unknown as EquipmentSummary).serial_number ?? undefined} onPress={() => onOpenExisting(d.id)} />)}
      <Button small kind="secondary" icon="add" title={t('differentEquipment')} busy={busy} onPress={() => save(true)} />
    </Card> : null}
  </Screen>;
}

/** Equipment list for one location, inside the customer screen. */
export function LocationEquipment({ membership, locationId, onAdd, onOpen }: { membership: Membership; locationId: string; onAdd: () => void; onOpen: (id: string) => void }) {
  const t = useT();
  const title = useEquipmentTitle();
  const [items, setItems] = useState<EquipmentSummary[] | null>(null);
  useEffect(() => { api.equipmentList(membership.organization_id, locationId).then(r => setItems(r.items), () => setItems([])); }, [locationId]);
  return <View style={styles.equipment}>
    {items?.map(e => {
      const [icon, tone] = categoryIcon(e.category);
      return <Pressable key={e.id} accessibilityRole="button" onPress={() => onOpen(e.id)} style={({ pressed }) => [styles.equipmentRow, pressed && { opacity: 0.7 }]}>
        {e.thumbnail_url ? <Image source={{ uri: e.thumbnail_url }} style={styles.thumb} /> : <IconTile icon={icon} tone={tone} />}
        <View style={{ flex: 1 }}>
          <Text style={styles.equipmentTitle}>{title(e)}</Text>
          {e.serial_number ? <Text style={styles.equipmentSub}>S/N {e.serial_number}</Text> : null}
        </View>
        <Icon name="chevron-forward" size={18} color={colors.faint} />
      </Pressable>;
    })}
    {items && !items.length ? <Text style={styles.equipmentSub}>{t('noEquipment')}</Text> : null}
    <Button small kind="secondary" icon="add-circle" title={t('addEquipment')} onPress={onAdd} />
  </View>;
}

export function EquipmentDetail({ membership, equipmentId, onBack }: { membership: Membership; equipmentId: string; onBack: () => void }) {
  const t = useT();
  const errorText = useErrorText();
  const title = useEquipmentTitle();
  const org = membership.organization_id;
  const [item, setItem] = useState<Equipment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({ name: '', brand: '', model: '', serial_number: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.equipment(org, equipmentId).then(setItem, e => setError(errorText(e))); }, [equipmentId]);
  useEffect(load, [load]);
  if (!item) return error ? <Screen onBack={onBack}><Banner text={error} /></Screen> : <Loading />;
  const [icon, tone] = categoryIcon(item.category);

  async function addPhoto(source: 'camera' | 'library') {
    setError(null);
    try {
      const picked = await pickPhoto(source);
      if (!picked) return;
      setBusy(true);
      const media = await uploadPhoto(org, picked, 'equipment');
      setItem(await api.addEquipmentPhotos(org, item!.id, [{ media_asset_id: media.id, photo_type: 'equipment' }]));
    } catch (e) { setError(e instanceof CameraDeniedError ? t('cameraDenied') : errorText(e)); } finally { setBusy(false); }
  }
  async function saveEdit() {
    setBusy(true); setError(null);
    try {
      setItem(await api.updateEquipment(org, item!.id, { expected_version: item!.version, name: values.name.trim() || null, brand: values.brand.trim() || null,
        model: values.model.trim() || null, serial_number: values.serial_number.trim() || null }));
      setEditing(false);
    } catch (e) { setError(errorText(e)); if (e instanceof ApiFailure && e.code === 'VERSION_CONFLICT') load(); } finally { setBusy(false); }
  }
  const line = (label: string, value: string | null) => <View style={styles.fieldLine}><Text style={styles.fieldLabel}>{label}</Text><Text style={styles.fieldValue}>{value || t('unknown')}</Text></View>;

  return <Screen onBack={onBack}>
    <View style={styles.slotHead}><IconTile icon={icon} tone={tone} size={56} /><View style={{ flex: 1 }}><Title>{title(item)}</Title>
      <Sub>{t(`category.${categories.includes(item.category as never) ? item.category : 'other'}` as TranslationKey)}</Sub></View></View>
    <Banner text={error} />
    {item.photos.length ? <View style={styles.gallery}>
      {item.photos.map(p => p.thumbnail_url ? <Pressable key={p.id} onPress={() => { if (p.url) void Linking.openURL(p.url); }}>
        <Image source={{ uri: p.thumbnail_url }} style={styles.galleryImage} accessibilityLabel={p.photo_type} />
      </Pressable> : null)}
    </View> : null}
    <View style={styles.row}>
      <View style={{ flex: 1 }}><Button small kind="secondary" icon="camera" title={t('takePhoto')} busy={busy} onPress={() => addPhoto('camera')} /></View>
      <View style={{ flex: 1 }}><Button small kind="secondary" icon="images" title={t('choosePhoto')} busy={busy} onPress={() => addPhoto('library')} /></View>
    </View>
    {editing ? <Card>
      <Field label={t('equipmentName')} value={values.name} onChangeText={v => setValues({ ...values, name: v })} maxLength={80} />
      <Field label={t('brand')} value={values.brand} onChangeText={v => setValues({ ...values, brand: v })} maxLength={80} />
      <Field label={t('model')} value={values.model} onChangeText={v => setValues({ ...values, model: v })} autoCapitalize="characters" maxLength={80} />
      <Field label={t('serial')} value={values.serial_number} onChangeText={v => setValues({ ...values, serial_number: v })} autoCapitalize="characters" hint={t('serialHint')} maxLength={80} />
      <View style={styles.row}>
        <View style={{ flex: 1 }}><Button small icon="checkmark" title={t('save')} busy={busy} onPress={saveEdit} /></View>
        <View style={{ flex: 1 }}><Button small kind="secondary" title={t('cancel')} onPress={() => setEditing(false)} /></View>
      </View>
    </Card> : <Card>
      {line(t('brand'), item.brand)}{line(t('model'), item.model)}{line(t('serial'), item.serial_number)}
      <Button small kind="secondary" icon="create-outline" title={t('edit')} onPress={() => {
        setValues({ name: item.name ?? '', brand: item.brand ?? '', model: item.model ?? '', serial_number: item.serial_number ?? '' }); setEditing(true);
      }} />
    </Card>}
    <EquipmentHistoryView membership={membership} equipmentId={item.id} />
  </Screen>;
}

const styles = StyleSheet.create({
  slotHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  slotImage: { width: 56, height: 56, borderRadius: 14, backgroundColor: colors.line },
  row: { flexDirection: 'row', gap: 10, marginTop: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.ink },
  chipTextOn: { color: colors.onPrimary },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primarySoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 6 },
  suggestionText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.ink },
  suggestionUse: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: colors.primary },
  equipment: { gap: 8, marginTop: 4 },
  equipmentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg, borderRadius: 12, padding: 10 },
  thumb: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.line },
  equipmentTitle: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22, color: colors.ink },
  equipmentSub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.muted },
  gallery: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  galleryImage: { width: 96, height: 96, borderRadius: 12, backgroundColor: colors.line },
  fieldLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  fieldLabel: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.muted },
  fieldValue: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.ink },
});
