'use client';
import { useContext, useEffect, useRef, useState } from 'react';
import { api, ApiFailure, type Customer, type CustomerLocation, type Equipment, type EquipmentInput, type EquipmentSummary, type Media, type OcrRequest } from './api';
import type { Go } from './OwnerApp';
import { ActionState, Button, dateTime, Empty, Field, LanguageContext, Note, Notice, PageTitle, Panel, Pagination, PhotoUpload, ResourceState, Select, statusText, useAction, useResource, useText, uuid } from './ui';
const categories = ['air_conditioner', 'water_filter', 'cctv', 'solar', 'pump', 'refrigeration', 'other'];
export function useEquipmentName() { const lang = useContext(LanguageContext); return (e: EquipmentSummary) => e.name || [statusText(lang, 'category', e.category), e.brand, e.model].filter(Boolean).join(' '); }
export function CustomersView({ org, go }: { org: string; go: Go }) {
  const t = useText(), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [adding, setAdding] = useState(false), [offset, setOffset] = useState(0), r = useResource(() => api.customers(org, search, offset, 50), [org, search, offset]);
  return <><PageTitle action={<Button kind="primary" onClick={() => setAdding(!adding)}>{t('addCustomer')}</Button>}>{t('customers')}</PageTitle>
    {adding ? <CustomerEditor org={org} onDone={c => go({ section: 'customer', id: c.id })} onCancel={() => setAdding(false)} /> : null}
    <form className="inline search-form" onSubmit={e => { e.preventDefault(); setSearch(query.trim()); setOffset(0); }}><Field label={t('ownerWeb.search_name_or_phone')} value={query} onChange={e => setQuery(e.target.value)} /><Button type="submit" kind="primary">{t('ownerWeb.search')}</Button></form><ResourceState resource={r} />
    <Panel><div className="table-scroll"><table><thead><tr><th>{t('customers')}</th><th>{t('phone')}</th><th>{t('ownerWeb.locations')}</th><th>{t('ownerWeb.with_coordinates')}</th></tr></thead><tbody>{r.data?.items.map(c => <tr key={c.id}><td><Button kind="link" onClick={() => go({ section: 'customer', id: c.id })}>{c.name || c.phone_normalized}</Button></td><td>{c.phone_normalized ? <a href={`tel:${c.phone_normalized}`}>{c.phone_normalized}</a> : '—'}</td><td>{c.location_count}</td><td>{c.located_count}</td></tr>)}</tbody></table></div>{r.data && !r.data.items.length ? <Empty /> : null}<Pagination offset={offset} size={50} more={!!r.data?.has_more} busy={r.loading} onPage={setOffset} /></Panel></>;
}
function CustomerEditor({ org, customer, onDone, onCancel }: { org: string; customer?: Customer; onDone: (c: Customer) => void; onCancel: () => void }) {
  const t = useText(), a = useAction(), key = useRef<string | null>(null);
  const [name, setName] = useState(customer?.name ?? ''), [phone, setPhone] = useState(customer?.phone_normalized ?? ''), [note, setNote] = useState(customer?.note ?? ''), [label, setLabel] = useState(''), [address, setAddress] = useState(''), [duplicate, setDuplicate] = useState<ApiFailure | null>(null);
  async function submit(confirm = false) {
    await a.run(async () => {
      try {
        const saved = customer ? await api.updateCustomer(org, customer.id, { expected_version: customer.version, name: name.trim(), phone: phone.trim(), note: note.trim() })
          : await api.createCustomer(org, { request_key: key.current ?? (key.current = uuid()), name: name.trim() || undefined, phone: phone.trim() || undefined, note: note.trim() || undefined, confirm_duplicate: confirm, location: label.trim() ? { label: label.trim(), address: address.trim() || undefined } : undefined });
        onDone(saved);
      } catch (e) { if (e instanceof ApiFailure && e.candidates.length) setDuplicate(e); throw e; }
    });
  }
  return <Panel title={customer ? t('edit') : t('addCustomer')}><form onSubmit={e => { e.preventDefault(); void submit(); }}><div className="grid2"><Field label={t('ownerWeb.name_optional_with_phone')} value={name} maxLength={200} onChange={e => { setName(e.target.value); setDuplicate(null); }} /><Field label={t('phone')} type="tel" value={phone} onChange={e => { setPhone(e.target.value); setDuplicate(null); }} /></div><Note label={t('ownerWeb.notes')} value={note} maxLength={2000} onChange={e => setNote(e.target.value)} />
    {!customer ? <div className="grid2"><Field label={t('ownerWeb.first_location_name_optional')} value={label} onChange={e => setLabel(e.target.value)} /><Field label={t('ownerWeb.address')} value={address} onChange={e => setAddress(e.target.value)} /></div> : null}<ActionState action={a} />
    {duplicate ? <Notice error>{t('ownerWeb.possible_duplicate_review_before_saving')}{duplicate.candidates.map(c => <span key={c.id}> · {c.name || c.phone_normalized}</span>)} <Button busy={a.busy} onClick={() => submit(true)}>{t('ownerWeb.create_a_separate_customer')}</Button></Notice> : null}
    <div className="actions"><Button kind="primary" type="submit" busy={a.busy} disabled={!name.trim() && !phone.trim()}>{t('save')}</Button><Button onClick={onCancel}>{t('cancel')}</Button></div></form></Panel>;
}
export function CustomerView({ org, id, go }: { org: string; id: string; go: Go }) {
  const t = useText(), a = useAction(), r = useResource(() => api.customer(org, id), [org, id]);
  const [editing, setEditing] = useState(false), [adding, setAdding] = useState(false), c = r.data;
  return <><Button onClick={() => go({ section: 'customers' })}>← {t('customers')}</Button><ResourceState resource={r} /><ActionState action={a} />{c ? <><PageTitle action={<Button onClick={() => setEditing(!editing)}>{t('edit')}</Button>}>{c.name || c.phone_normalized}</PageTitle>
    {editing ? <CustomerEditor key={c.version} org={org} customer={c} onCancel={() => setEditing(false)} onDone={saved => { r.setData(saved); setEditing(false); }} /> : <Panel>{c.phone_normalized ? <p><a href={`tel:${c.phone_normalized}`}>{c.phone_normalized}</a></p> : null}<p>{c.note}</p></Panel>}
    <PageTitle action={<Button onClick={() => setAdding(!adding)}>{t('ownerWeb.add_location')}</Button>}>{t('ownerWeb.locations_equipment')}</PageTitle>
    {adding ? <LocationEditor org={org} customerId={id} onDone={() => { setAdding(false); void r.reload(); }} onCancel={() => setAdding(false)} /> : null}
    {c.locations.map(l => <LocationCard key={`${l.id}:${l.version}`} org={org} customerId={id} location={l} go={go} onUpdated={r.reload} />)}
    {!c.locations.length ? <Empty /> : null}<Button kind="danger" busy={a.busy} onClick={() => { if (window.confirm(t('ownerWeb.archive_this_customer_history_is_retained'))) void a.run(async () => { await api.archiveCustomer(org, id); go({ section: 'customers' }); }); }}>{t('ownerWeb.archive_customer')}</Button></> : null}</>;
}
function LocationEditor({ org, customerId, location, onDone, onCancel }: { org: string; customerId: string; location?: CustomerLocation; onDone: () => void; onCancel: () => void }) {
  const t = useText(), a = useAction(), key = useRef<string | null>(null), [label, setLabel] = useState(location?.label ?? ''), [address, setAddress] = useState(location?.address ?? ''), [note, setNote] = useState(location?.travel_note ?? '');
  return <Panel><form onSubmit={e => { e.preventDefault(); void a.run(async () => {
    if (location) await api.updateLocation(org, location.id, { expected_version: location.version, label: label.trim(), address: address.trim() || null, travel_note: note.trim() || null });
    else await api.addLocation(org, customerId, { request_key: key.current ?? (key.current = uuid()), label: label.trim(), address: address.trim() || undefined, travel_note: note.trim() || undefined }); onDone();
  }); }}><Field label={t('ownerWeb.location_name')} value={label} required maxLength={200} onChange={e => setLabel(e.target.value)} /><Note label={t('ownerWeb.address')} value={address} onChange={e => setAddress(e.target.value)} /><Note label={t('ownerWeb.directions_landmarks')} value={note} onChange={e => setNote(e.target.value)} /><ActionState action={a} /><div className="actions"><Button kind="primary" type="submit" busy={a.busy}>{t('save')}</Button><Button onClick={onCancel}>{t('cancel')}</Button></div></form></Panel>;
}
function LocationCard({ org, customerId, location: l, go, onUpdated }: { org: string; customerId: string; location: CustomerLocation; go: Go; onUpdated: () => Promise<void> }) {
  const t = useText(), a = useAction(), r = useResource(() => api.equipmentList(org, l.id), [org, l.id]), equipmentName = useEquipmentName();
  const [editing, setEditing] = useState(false), [adding, setAdding] = useState(false), [coordinates, setCoordinates] = useState(false);
  const [lat, setLat] = useState(l.latitude?.toString() ?? ''), [lng, setLng] = useState(l.longitude?.toString() ?? ''), [method, setMethod] = useState<'current_location' | 'manual_pin'>('manual_pin'), [accuracy, setAccuracy] = useState<number | null>(null), [gpsError, setGpsError] = useState('');
  return <Panel title={l.label}><p>{l.address}</p><p className="muted">{l.travel_note}</p><div className="actions"><Button onClick={() => setEditing(!editing)}>{t('edit')}</Button><Button onClick={() => go({ section: 'jobNew', customerId, locationId: l.id })}>{t('createJob')}</Button><Button onClick={() => go({ section: 'service', customerId, locationId: l.id })}>{t('recordAdhoc')}</Button><Button onClick={() => setCoordinates(!coordinates)}>{t('ownerWeb.location_coordinates')}</Button>
    {l.latitude !== null && l.longitude !== null ? <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${l.latitude},${l.longitude}`}>{t('ownerWeb.navigate')}</a> : <span className="muted">{t('ownerWeb.no_coordinates')}</span>}</div>
    {editing ? <LocationEditor org={org} customerId={customerId} location={l} onDone={() => { setEditing(false); void onUpdated(); }} onCancel={() => setEditing(false)} /> : null}
    {coordinates ? <form onSubmit={e => { e.preventDefault(); if (l.latitude !== null && !window.confirm(t('ownerWeb.replace_existing_coordinates'))) return;
      void a.run(async () => { await api.saveCoordinates(org, l.id, { expected_version: l.version, latitude: Number(lat), longitude: Number(lng), accuracy_m: accuracy, method, replace_existing: l.latitude !== null }); await onUpdated(); }, t('saved'));
    }}><Notice>{t('gpsPolicy')}</Notice><Button onClick={() => {
      setGpsError(''); if (!navigator.geolocation) { setGpsError(t('ownerWeb.location_is_unavailable_in_this_browser')); return; }
      navigator.geolocation.getCurrentPosition(p => { setLat(String(p.coords.latitude)); setLng(String(p.coords.longitude)); setAccuracy(p.coords.accuracy); setMethod('current_location'); }, () => setGpsError(t('ownerWeb.location_unavailable_enter_coordinates_manually_gps_requires_https')), { enableHighAccuracy: true, timeout: 15000 });
    }}>{t('ownerWeb.fill_from_current_location_then_review')}</Button><Notice error>{gpsError}</Notice><div className="grid2"><Field label={t('ownerWeb.latitude')} type="number" required min={-90} max={90} step="any" value={lat} onChange={e => { setLat(e.target.value); setMethod('manual_pin'); setAccuracy(null); }} /><Field label={t('ownerWeb.longitude')} type="number" required min={-180} max={180} step="any" value={lng} onChange={e => { setLng(e.target.value); setMethod('manual_pin'); setAccuracy(null); }} /></div><Button type="submit" busy={a.busy} kind="primary">{t('save')}</Button><ActionState action={a} /></form> : null}
    <h3>{t('equipment')}</h3><ResourceState resource={r} /><div className="equipment-grid">{r.data?.items.map(e => <Button key={e.id} className="equipment-card" onClick={() => go({ section: 'equipment', id: e.id })}>{e.thumbnail_url ? <img src={e.thumbnail_url} alt="" /> : <span className="equipment-placeholder">◇</span>}<strong>{equipmentName(e)}</strong><span className="muted">{e.serial_number || '—'}</span></Button>)}</div>{r.data && !r.data.items.length ? <Empty /> : null}
    <Button onClick={() => setAdding(!adding)}>{t('addEquipment')}</Button>{adding ? <EquipmentEditor org={org} locationId={l.id} onDone={e => go({ section: 'equipment', id: e.id })} onCancel={() => setAdding(false)} /> : null}</Panel>;
}
function EquipmentEditor({ org, locationId, equipment, onDone, onCancel }: { org: string; locationId: string; equipment?: Equipment; onDone: (e: Equipment) => void; onCancel: () => void }) {
  const t = useText(), lang = useContext(LanguageContext), a = useAction(), key = useRef<string | null>(null);
  const [fields, setFields] = useState<EquipmentInput>({ category: equipment?.category ?? 'air_conditioner', name: equipment?.name ?? '', brand: equipment?.brand ?? '', model: equipment?.model ?? '', serial_number: equipment?.serial_number ?? '', note: equipment?.note ?? '' });
  const [photos, setPhotos] = useState<{ media_asset_id: string; photo_type: string }[]>([]), [ocr, setOcr] = useState<OcrRequest | null>(null), [duplicate, setDuplicate] = useState<ApiFailure | null>(null);
  const [uploads, setUploads] = useState<Set<string>>(new Set());
  const trackUpload = (type: string) => (busy: boolean) => setUploads(current => { const next = new Set(current); if (busy) next.add(type); else next.delete(type); return next; });
  useEffect(() => {
    if (!ocr || !['queued', 'running'].includes(ocr.status)) return;
    let live = true, attempts = 0;
    const timer = setInterval(() => { if (++attempts > 30) { clearInterval(timer); return; } api.ocr(org, ocr.id).then(r => { if (live) setOcr(r); }, () => {}); }, 1500);
    return () => { live = false; clearInterval(timer); };
  }, [org, ocr?.id, ocr?.status]);
  const photoReady = (type: string) => async (m: Media) => {
    setPhotos(p => [...p.filter(x => x.photo_type !== type), { media_asset_id: m.id, photo_type: type }]);
    if (type === 'nameplate') { try { setOcr(await api.requestOcr(org, m.id, uuid())); } catch { setOcr(null); } }
  };
  async function submit(confirm = false) {
    if (uploads.size) return;
    await a.run(async () => {
      try { const result = equipment ? await api.updateEquipment(org, equipment.id, { ...fields, expected_version: equipment.version }) : await api.createEquipment(org, locationId, { ...fields, request_key: key.current ?? (key.current = uuid()), photos, ocr_request_id: ocr?.status === 'succeeded' ? ocr.id : undefined, confirm_duplicate: confirm }); onDone(result); }
      catch (e) { if (e instanceof ApiFailure && e.candidates.length) setDuplicate(e); throw e; }
    });
  }
  return <Panel title={equipment ? t('edit') : t('addEquipment')}><Notice>{t('aiPolicy')}</Notice>{!equipment ? <div className="grid2"><PhotoUpload org={org} purpose="nameplate" label={t('nameplatePhoto')} onBusy={trackUpload('nameplate')} onReady={photoReady('nameplate')} /><PhotoUpload org={org} purpose="equipment" label={t('equipmentPhoto')} onBusy={trackUpload('equipment')} onReady={photoReady('equipment')} /></div> : null}
    {ocr ? <Notice>{t(['queued', 'running'].includes(ocr.status) ? 'ocrReading' : ocr.status === 'failed' || ocr.status === 'cancelled' ? 'ocrFailed' : ocr.suggestions?.fields && Object.values(ocr.suggestions.fields).some(Boolean) ? 'ocrDone' : 'ocrEmpty')}</Notice> : null}
    {ocr?.suggestions?.fields ? <Panel title={t('ownerWeb.ocr_suggestions_review_before_saving')}>{Object.entries(ocr.suggestions.fields).filter(([, value]) => value).map(([field, value]) => <Button key={field} onClick={() => setFields(v => ({ ...v, [field]: value }))}>{statusText(lang, 'equipmentField', field)}: {value} ✓</Button>)}</Panel> : null}
    <form onSubmit={e => { e.preventDefault(); void submit(); }}><Select label={t('ownerWeb.equipment_category')} value={fields.category} onChange={e => setFields(v => ({ ...v, category: e.target.value }))}>{categories.map(c => <option key={c} value={c}>{statusText(lang, 'category', c)}</option>)}</Select>
      <div className="grid2">{(['name', 'brand', 'model', 'serial_number'] as const).map(field => <Field key={field} label={field === 'name' ? t('ownerWeb.equipment_name') : field === 'brand' ? t('ownerWeb.brand') : field === 'model' ? t('ownerWeb.model') : 'Serial number'} value={fields[field] ?? ''} maxLength={200} onChange={e => { setFields(v => ({ ...v, [field]: e.target.value })); setDuplicate(null); }} />)}</div><Note label={t('ownerWeb.notes')} value={fields.note ?? ''} onChange={e => setFields(v => ({ ...v, note: e.target.value }))} /><ActionState action={a} />
      {duplicate ? <Notice error>{t('ownerWeb.possible_duplicate_serial_number')}<Button onClick={() => submit(true)} busy={a.busy} disabled={uploads.size > 0}>{t('ownerWeb.save_a_separate_unit')}</Button></Notice> : null}<div className="actions"><Button type="submit" busy={a.busy} disabled={uploads.size > 0} kind="primary">{t('save')}</Button><Button onClick={onCancel}>{t('cancel')}</Button></div></form></Panel>;
}
export function EquipmentView({ org, id, go }: { org: string; id: string; go: Go }) {
  const t = useText(), lang = useContext(LanguageContext), a = useAction(), name = useEquipmentName(), [editing, setEditing] = useState(false);
  const r = useResource(async () => { const [equipment, history] = await Promise.all([api.equipment(org, id), api.equipmentHistory(org, id)]); return { equipment, history }; }, [org, id]), e = r.data?.equipment;
  return <><ResourceState resource={r} /><ActionState action={a} />{e && r.data ? <><Button onClick={() => go({ section: 'customer', id: e.customer_id })}>← {t('customers')}</Button><PageTitle action={<Button onClick={() => setEditing(!editing)}>{t('edit')}</Button>}>{name(e)}</PageTitle>
    {editing ? <EquipmentEditor key={e.version} org={org} locationId={e.location_id} equipment={e} onDone={() => { setEditing(false); void r.reload(); }} onCancel={() => setEditing(false)} /> : <Panel><p>{e.brand} · {e.model} · S/N {e.serial_number || '—'}</p><p>{e.note}</p></Panel>}
    <Panel title={t('ownerWeb.equipment_photos')}><div className="photo-gallery">{e.photos.filter(p => p.url).map(p => <a key={p.id} href={p.url!} target="_blank" rel="noreferrer"><img src={p.thumbnail_url || p.url!} alt={statusText(lang, 'photoType', p.photo_type)} /></a>)}</div><PhotoUpload org={org} purpose="equipment" label={t('choosePhoto')} onReady={async m => { await api.addEquipmentPhotos(org, id, [{ media_asset_id: m.id, photo_type: 'equipment' }]); await r.reload(); }} /></Panel>
    <Panel title={t('maintenance')}>{r.data.history.maintenance.map((m, i) => <p key={i}>{statusText(lang, 'jobType', m.service_type)} · {m.enabled ? m.due_date || '—' : t('ownerWeb.reminders_off')}</p>)}</Panel>
    <Panel title={t('history')}>{r.data.history.items.length ? r.data.history.items.map(h => <article className="history-entry" key={h.id}><h3>{statusText(lang, 'jobType', h.service_type)} · {statusText(lang, 'outcome', h.outcome)}</h3><p className="muted">{dateTime(h.occurred_at, lang)} · {h.performed_by_name}</p><p>{h.work_note}</p><p>{h.problem_note}</p><p>{h.not_done_reason}</p><p>{h.note}</p><p>{h.next_due_on}</p><div className="photo-gallery">{h.photos.filter(p => p.url).map((p, i) => <a key={i} href={p.url!} target="_blank" rel="noreferrer"><img src={p.thumbnail_url || p.url!} alt={statusText(lang, 'photoType', p.photo_type)} /></a>)}</div></article>) : <Empty />}</Panel></> : null}</>;
}
