import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { formatPhone, normalizePhone } from '@field-service/core';
import type { TranslationKey } from '@field-service/i18n';
import { api, ApiFailure, type Customer, type CustomerLocation, type CustomerSummary, type Membership } from '../api';
import { LocationEquipment } from './equipment';
import { ActionTrio, Avatar, Badge, Banner, Button, Card, colors, confirm, Disclosure, Field, fonts, Icon, IconButton, IconTile, Loading, Row, Screen, Section, Strong, Sub, Title, useErrorText, useT } from '../ui';

const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
});
/** The customer's name, or the phone when there is no name yet — never an invented name. */
export const customerTitle = (c: { name: string | null; phone_normalized: string | null }) =>
  c.name?.trim() || (c.phone_normalized ? formatPhone(c.phone_normalized) : '—');

/** Google Maps link with the saved coordinates; without them, a search for the address. */
export function mapsUrl(location: Pick<CustomerLocation, 'latitude' | 'longitude' | 'address' | 'label'>) {
  const query = location.latitude !== null && location.longitude !== null
    ? `${location.latitude},${location.longitude}` : encodeURIComponent(location.address || location.label);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}
export function openMaps(location: Pick<CustomerLocation, 'latitude' | 'longitude' | 'address' | 'label'>) { void Linking.openURL(mapsUrl(location)); }

export function CustomersScreen({ membership, onOpen, onCreate }: { membership: Membership; onOpen: (id: string) => void; onCreate: (search: string) => void }) {
  const t = useT();
  const errorText = useErrorText();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<CustomerSummary[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      api.customers(membership.organization_id, q.trim()).then(r => { if (mine === seq.current) { setItems(r.items); setNext(r.next_offset); setError(null); } },
        e => { if (mine === seq.current) setError(errorText(e)); });
    }, 250);
    return () => clearTimeout(timer);
  }, [q, membership.organization_id]);
  async function loadMore() {
    if (next === null || more) return;
    const mine = seq.current;
    setMore(true);
    try {
      const r = await api.customers(membership.organization_id, q.trim(), next);
      if (mine === seq.current) { setItems(prev => [...(prev ?? []), ...r.items.filter(c => !prev?.some(p => p.id === c.id))]); setNext(r.next_offset); }
    } catch (e) { if (mine === seq.current) setError(errorText(e)); } finally { setMore(false); }
  }

  return <Screen title={t('customers')} right={<Button small kind="tonal" icon="person-add" title={t('addCustomer')} onPress={() => onCreate(q)} />}>
    <Field label={t('searchCustomers')} icon="search" value={q} onChangeText={setQ} autoCorrect={false} placeholder={t('ownerWeb.searchCustomerHint')} />
    {membership.role !== 'owner' ? <Sub>{t('technicianCustomersHint')}</Sub> : null}
    <Banner text={error} />
    {!items ? <Loading /> : items.length === 0
      ? <Card><Sub>{q.trim() ? t('noResults') : t('noCustomers')}</Sub>
          {q.trim() ? <Button small icon="person-add" title={t('addCustomer')} onPress={() => onCreate(q)} /> : null}</Card>
      : <Card padded={false}>
        {items.map((c, i) => <Row key={c.id} last={i === items.length - 1} onPress={() => onOpen(c.id)}
          icon={<Avatar name={c.name ?? ''} tone={c.customer_type === 'business' ? 'amber' : 'violet'} />}
          title={customerTitle(c)}
          subtitle={[c.first_address, c.name && c.phone_normalized ? formatPhone(c.phone_normalized) : null, c.location_count > 1 ? t('locationCount', { count: c.location_count }) : null].filter(Boolean).join(' · ')}
          trailing={c.location_count ? <Badge text={c.located_count ? t('hasCoordinates') : t('noCoordinates')} tone={c.located_count ? 'ok' : 'neutral'} /> : undefined} />)}
      </Card>}
    {items && next !== null ? <Button kind="secondary" icon="chevron-down" title={t('loadMore')} busy={more} onPress={loadMore} /> : null}
  </Screen>;
}

/** Phone first, name optional, first place in the same step. Retry-safe via a request key
 * kept for the whole form; a known phone shows the existing customers to pick from. */
export function CustomerForm({ membership, initialSearch, intent, onBack, onSaved, onOpenExisting }: {
  membership: Membership; initialSearch: string; intent?: 'jobNew' | 'serviceAdhoc'; onBack: () => void; onSaved: (customer: Customer) => void; onOpenExisting: (id: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const key = useRef(uuid()).current;
  const fromSearch = initialSearch.replace(/[^\d+]/g, '').length >= 9;
  const [phone, setPhone] = useState(fromSearch ? initialSearch : '');
  const [name, setName] = useState(fromSearch ? '' : initialSearch);
  const [business, setBusiness] = useState(false);
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [travel, setTravel] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<ApiFailure['candidates']>([]);
  const [busy, setBusy] = useState(false);
  const [capture, setCapture] = useState<Capture>({ state: 'idle' });
  const captureReading = useRef(false);

  async function save(confirmDuplicate = false) {
    if (busy || capture.state === 'reading') return;
    const next: Record<string, string> = {};
    if (phone.trim() && !normalizePhone(phone)) next.phone = t('field.phone');
    if (!phone.trim()) next.phone = t('field.required');
    if (!label.trim()) next.label = t('field.required');
    setErrors(next); setFailure(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const saved = await api.createCustomer(membership.organization_id, {
        request_key: key, name: name.trim() || undefined, phone: phone.trim() || undefined, customer_type: business ? 'business' : 'individual',
        confirm_duplicate: confirmDuplicate || undefined, location: { label: label.trim(), address: address.trim() || undefined, travel_note: travel.trim() || undefined,
          coordinates: capture.state === 'preview' ? { latitude: capture.latitude, longitude: capture.longitude, accuracy_m: capture.accuracy === null ? null : Math.round(capture.accuracy), method: 'current_location' } : undefined },
      });
      onSaved(saved);
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'DUPLICATE_WARNING') setDuplicates(e.candidates);
      else if (e instanceof ApiFailure && Object.keys(e.fieldErrors).length) setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k.replace(/^location\./, ''), t(v as TranslationKey)])));
      else setFailure(errorText(e));
    } finally { setBusy(false); }
  }

  async function readLocation() {
    if (captureReading.current || busy) return;
    captureReading.current = true;
    setCapture({ state: 'reading' });
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') { setCapture({ state: 'error', message: t('locationDenied') }); return; }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setCapture({ state: 'preview', latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy ?? null });
    } catch { setCapture({ state: 'error', message: t('locationUnavailable') }); }
    finally { captureReading.current = false; }
  }

  return <Screen onBack={onBack} footer={<Button title={t(intent === 'serviceAdhoc' ? 'saveAndService' : intent === 'jobNew' ? 'saveAndJob' : 'saveCustomer')} icon="checkmark" busy={busy} disabled={capture.state === 'reading'} onPress={() => save()} />}>
    <Title>{t('addCustomer')}</Title>
    <Sub>{t('requiredFieldsHint')}</Sub>
    <Sub>{t('customerIdentityHint')}</Sub>
    <Field required label={t('customerPhone')} icon="call-outline" value={phone} onChangeText={setPhone} error={errors.phone} keyboardType="phone-pad" placeholder="08x-xxx-xxxx" />
    <Field label={t('customerName')} icon="person-outline" value={name} onChangeText={setName} hint={t('customerNameHint')} maxLength={120} />
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: business }} onPress={() => setBusiness(!business)} style={styles.check}>
      <Icon name={business ? 'checkbox' : 'square-outline'} size={22} color={business ? colors.primary : colors.faint} />
      <Text style={styles.checkText}>{t('businessCustomer')}</Text>
    </Pressable>
    <Section>{t('firstLocation')}</Section>
    <Field required label={t('locationLabel')} icon="home-outline" value={label} onChangeText={setLabel} error={errors.label} hint={t('locationLabelHint')} maxLength={80} />
    <Disclosure title={t('optionalDetails')}>
      <Field label={t('address')} icon="map-outline" value={address} onChangeText={setAddress} multiline maxLength={500} />
      <Field label={t('travelNote')} icon="navigate-outline" value={travel} onChangeText={setTravel} multiline maxLength={500} />
    </Disclosure>
    <Button kind="secondary" icon="locate" title={t('useCurrentLocation')} busy={capture.state === 'reading'} disabled={busy} onPress={readLocation} />
    <Sub>{t('captureHint')}</Sub>
    {capture.state === 'preview' ? <View style={styles.preview}>
      <Text style={styles.coords}>{capture.latitude.toFixed(6)}, {capture.longitude.toFixed(6)}</Text>
      <Sub>{t('capturedPreview', { meters: capture.accuracy === null ? '?' : Math.round(capture.accuracy) })}</Sub>
      {capture.accuracy !== null && capture.accuracy > 50 ? <Banner tone="info" text={t('lowAccuracy')} /> : null}
      <Button small kind="ghost" title={t('removeCapturedLocation')} disabled={busy} onPress={() => setCapture({ state: 'idle' })} />
    </View> : null}
    {capture.state === 'error' ? <Banner tone="info" text={capture.message} /> : null}
    <Banner text={failure} />
    {duplicates.length ? <Card>
      <Strong>{t('duplicateTitle')}</Strong>
      <Sub>{t('duplicateBody')}</Sub>
      {duplicates.map(d => <Row key={d.id} icon={<Avatar name={d.name ?? ''} />} title={customerTitle(d)} onPress={() => onOpenExisting(d.id)} />)}
      <Button small kind="secondary" icon="person-add" title={t('createAnyway')} busy={busy} onPress={() => save(true)} />
    </Card> : null}
  </Screen>;
}

export function LocationForm({ membership, customerId, location, onBack, onSaved }: {
  membership: Membership; customerId: string; location?: CustomerLocation; onBack: () => void; onSaved: (customer: Customer) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const key = useRef(uuid()).current;
  const [label, setLabel] = useState(location?.label ?? '');
  const [address, setAddress] = useState(location?.address ?? '');
  const [travel, setTravel] = useState(location?.travel_note ?? '');
  const [error, setError] = useState<string>();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!label.trim()) { setError(t('field.required')); return; }
    setBusy(true); setFailure(null);
    try {
      onSaved(location
        ? await api.updateLocation(membership.organization_id, location.id, { expected_version: location.version, label: label.trim(), address: address.trim() || null, travel_note: travel.trim() || null })
        : await api.addLocation(membership.organization_id, customerId, { request_key: key, label: label.trim(), address: address.trim() || undefined, travel_note: travel.trim() || undefined }));
    } catch (e) { setFailure(errorText(e)); } finally { setBusy(false); }
  }
  return <Screen onBack={onBack} footer={<Button title={t('saveLocation')} icon="checkmark" busy={busy} onPress={save} />}>
    <Title>{location ? t('edit') : t('addLocation')}</Title>
    <Field required label={t('locationLabel')} icon="home-outline" value={label} onChangeText={setLabel} error={error} hint={t('locationLabelHint')} maxLength={80} />
    <Field label={t('address')} icon="map-outline" value={address} onChangeText={setAddress} multiline maxLength={500} />
    <Field label={t('travelNote')} icon="navigate-outline" value={travel} onChangeText={setTravel} multiline maxLength={500} />
    <Banner text={failure} />
  </Screen>;
}

type Capture = { state: 'idle' } | { state: 'reading' } | { state: 'preview'; latitude: number; longitude: number; accuracy: number | null } | { state: 'error'; message: string };

/** Reads the position once, only after the user taps the button, with "while using" permission.
 * Shows it for review; nothing is saved until the user confirms. */
function LocationCard({ membership, location, onChanged, onEdit, onAddEquipment, onOpenEquipment, onCreateJob, last }: {
  membership: Membership; location: CustomerLocation; onChanged: (customer: Customer) => void; onEdit: () => void;
  onAddEquipment: () => void; onOpenEquipment: (id: string) => void; onCreateJob?: () => void; last: boolean;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [capture, setCapture] = useState<Capture>({ state: 'idle' });
  const [saved, setSaved] = useState<number | null | undefined>(undefined);
  const located = location.latitude !== null;

  /** One tap reads and saves (design handoff F32): the button already says it uses or replaces the
   * place's position with where the phone is now, so there is no second confirmation. A failed read
   * or save keeps the old position. */
  async function read() {
    setCapture({ state: 'reading' }); setSaved(undefined);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') { setCapture({ state: 'error', message: t('locationDenied') }); return; }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const accuracy = position.coords.accuracy ?? null;
      try {
        onChanged(await api.saveCoordinates(membership.organization_id, location.id, {
          expected_version: location.version, latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy_m: accuracy !== null ? Math.round(accuracy) : null,
          method: 'current_location', replace_existing: located,
        }));
        setCapture({ state: 'idle' }); setSaved(accuracy === null ? null : Math.round(accuracy));
      } catch (e) { setCapture({ state: 'error', message: errorText(e) }); }
    } catch { setCapture({ state: 'error', message: t('locationUnavailable') }); }
  }

  return <View style={[styles.location, !last && styles.locationLine]}>
    <View style={styles.locationHead}>
      <IconTile icon={located ? 'location' : 'location-outline'} tone={located ? 'green' : 'sky'} />
      <View style={{ flex: 1 }}>
        <Text style={styles.locationTitle}>{location.label}</Text>
        {location.address ? <Text style={styles.locationText}>{location.address}</Text> : null}
        {location.travel_note ? <Text style={styles.locationText}>{location.travel_note}</Text> : null}
      </View>
      <IconButton icon="create-outline" label={t('edit')} onPress={onEdit} />
    </View>
    <Badge text={located ? t('hasCoordinates') : t('noCoordinates')} tone={located ? 'ok' : 'neutral'} />
    {!located ? <Sub>{t('addressOnly')}</Sub> : null}
    <View style={styles.actions}>
      <View style={{ flex: 1 }}><Button small kind="secondary" icon="navigate" title={t('navigate')} onPress={() => openMaps(location)} /></View>
      <View style={{ flex: 1 }}><Button small kind="secondary" icon="share-social" title={t('shareAddress')} onPress={() => { void Share.share({ message: [location.label, location.address, mapsUrl(location)].filter(Boolean).join('\n') }); }} /></View>
    </View>
    <Button small kind="tonal" icon="locate" title={located ? t('updateToCurrentLocation') : t('useCurrentLocation')} busy={capture.state === 'reading'} onPress={read} />
    {saved !== undefined ? <Banner tone={saved !== null && saved > 50 ? 'info' : 'success'} text={saved !== null && saved > 50 ? t('lowAccuracySaved', { meters: saved }) : t('locationSaved', { meters: saved ?? '?' })} /> : null}
    {capture.state === 'error' ? <Banner tone="info" text={capture.message} /> : null}
    {capture.state === 'idle' && !located ? <Text style={styles.hint}>{t('captureHint')}</Text> : null}
    <LocationEquipment membership={membership} locationId={location.id} onAdd={onAddEquipment} onOpen={onOpenEquipment} />
    {onCreateJob ? <Button small icon="briefcase" title={t('createJobHere')} onPress={onCreateJob} /> : null}
  </View>;
}

export function CustomerDetail({ membership, customerId, onBack, onAddLocation, onEditLocation, onAddEquipment, onOpenEquipment, onCreateJob }: {
  membership: Membership; customerId: string; onBack: () => void; onAddLocation: () => void; onEditLocation: (location: CustomerLocation) => void;
  onAddEquipment: (locationId: string) => void; onOpenEquipment: (id: string) => void; onCreateJob: (locationId: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.customer(membership.organization_id, customerId).then(setCustomer, e => setError(errorText(e))); }, [customerId]);
  useEffect(load, [load]);

  if (!customer) return error ? <Screen onBack={onBack}><Banner text={error} /></Screen> : <Loading />;
  function startEdit() { setName(customer!.name ?? ''); setPhone(customer!.phone_normalized ? formatPhone(customer!.phone_normalized) : ''); setNote(customer!.note ?? ''); setEditing(true); }
  async function saveEdit() {
    setBusy(true); setError(null);
    try { setCustomer(await api.updateCustomer(membership.organization_id, customer!.id, { expected_version: customer!.version, name: name.trim(), phone: phone.trim(), note: note.trim() })); setEditing(false); }
    catch (e) { setError(errorText(e)); if (e instanceof ApiFailure && e.code === 'VERSION_CONFLICT') load(); } finally { setBusy(false); }
  }
  async function archive() {
    if (!await confirm(t('archiveConfirm'), t('archiveCustomer'), t('cancel'))) return;
    try { await api.archiveCustomer(membership.organization_id, customer!.id); onBack(); } catch (e) { setError(errorText(e)); }
  }

  const first = customer.locations.find(l => l.latitude !== null) ?? customer.locations[0];
  return <Screen onBack={onBack} title={customerTitle(customer)}
    subtitle={customer.name?.trim() ? (customer.phone_normalized ? formatPhone(customer.phone_normalized) : t('noPhone')) : undefined}
    right={editing ? undefined : <IconButton icon="create-outline" label={t('edit')} onPress={startEdit} />}>
    <Banner text={error} />
    {editing ? <Card>
      <Field label={t('customerName')} value={name} onChangeText={setName} maxLength={120} />
      <Field label={t('customerPhone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label={t('customerNote')} value={note} onChangeText={setNote} multiline maxLength={1000} />
      <View style={styles.actions}>
        <View style={{ flex: 1 }}><Button small icon="checkmark" title={t('save')} busy={busy} onPress={saveEdit} /></View>
        <View style={{ flex: 1 }}><Button small kind="secondary" title={t('cancel')} onPress={() => setEditing(false)} /></View>
      </View>
    </Card> : <>
      <ActionTrio items={[
        { icon: 'call', label: t('call'), disabled: !customer.phone_normalized, onPress: () => { void Linking.openURL(`tel:${customer.phone_normalized}`); } },
        { icon: 'navigate', label: t('navigate'), disabled: !first, onPress: () => { if (first) openMaps(first); } },
        { icon: 'share-social', label: t('shareAddress'), disabled: !first, onPress: () => { if (first) void Share.share({ message: [customerTitle(customer), first.label, first.address, mapsUrl(first)].filter(Boolean).join('\n') }); } },
      ]} />
      {customer.note ? <Card><Sub>{customer.note}</Sub></Card> : null}
    </>}
    <Section action={<Button small kind="tonal" icon="add" title={t('addLocation')} onPress={onAddLocation} />}>{t('locations')}</Section>
    <Card padded={false}>
      {customer.locations.length === 0 ? <Row icon="home-outline" tone="sky" title={t('addLocation')} onPress={onAddLocation} last />
        : customer.locations.map((l, i) => <LocationCard key={l.id} membership={membership} location={l} last={i === customer.locations.length - 1}
          onChanged={setCustomer} onEdit={() => onEditLocation(l)} onAddEquipment={() => onAddEquipment(l.id)} onOpenEquipment={onOpenEquipment}
          onCreateJob={membership.role === 'owner' ? () => onCreateJob(l.id) : undefined} />)}
    </Card>
    {membership.role === 'owner' ? <Button kind="ghost" icon="archive-outline" title={t('archiveCustomer')} onPress={archive} /> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'space-between' },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  checkText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.ink },
  location: { padding: 16, gap: 8 },
  locationLine: { borderBottomWidth: 1, borderBottomColor: colors.line },
  locationHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  locationTitle: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 23, color: colors.ink },
  locationText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.muted },
  coords: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: colors.ink },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: colors.faint },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  preview: { backgroundColor: colors.bg, borderRadius: 12, padding: 12, gap: 4 },
});
