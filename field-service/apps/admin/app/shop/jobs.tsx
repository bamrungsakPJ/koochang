'use client';
import { useContext, useEffect, useRef, useState } from 'react';
import { formatPhone } from '@field-service/core';
import { api, ApiFailure, type CustomerSummary, type EquipmentSummary, type Job, type Membership, type ServiceBody, type ServiceItemInput, type ServiceResult } from './api';
import type { Go } from './OwnerApp';
import { ActionState, Button, Chips, dateTime, Empty, Field, fromInstant, LanguageContext, Note, Notice, PageTitle, Panel, Pagination, PhotoUpload, type PickOption, ResourceState, SearchSelect, Select, statusText, toInstant, useAction, useResource, useTeamOptions, useText, uuid } from './ui';
import { CoordinatesForm, CustomerEditor, LocationEditor, LocationMap, useEquipmentName } from './customers';
import { CustomerHistoryPanel, dayText } from './history';
const jobTypes = ['maintenance', 'repair', 'installation', 'inspection', 'other'];
export function JobsView({ org, go }: { org: string; go: Go }) {
  const t = useText(), lang = useContext(LanguageContext);
  const [status, setStatus] = useState(''), [assignee, setAssignee] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [offset, setOffset] = useState(0);
  const team = useResource(() => api.team(org), [org]), teamOptions = useTeamOptions(team.data?.members);
  const r = useResource(() => api.jobs(org, { limit: '50', offset: String(offset), status: status || 'unassigned,scheduled,in_progress,completed,cancelled', assignee, from: from ? toInstant(`${from}T00:00`) ?? undefined : '2000-01-01T00:00:00+07:00', to: to ? toInstant(`${to}T23:59`) ?? undefined : '2100-01-01T00:00:00+07:00' }), [org, status, assignee, from, to, offset]);
  return <><PageTitle action={<Button kind="primary" onClick={() => go({ section: 'jobNew' })}>{t('createJob')}</Button>}>{t('jobs')}</PageTitle><div className="filter-grid">
    <Select label={t('ownerWeb.status')} value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}><option value="">{t('ownerWeb.all')}</option>{['unassigned', 'scheduled', 'in_progress', 'completed', 'cancelled'].map(s => <option key={s} value={s}>{statusText(lang, 'status', s)}</option>)}</Select>
    <SearchSelect label={t('assignee')} selected={teamOptions.find(o => o.value === assignee) ?? null} options={teamOptions} placeholder={t('ownerWeb.all')} onSelect={o => { setAssignee(o?.value ?? ''); setOffset(0); }} />
    <Field label={t('ownerWeb.from')} type="date" value={from} onChange={e => { setFrom(e.target.value); setOffset(0); }} /><Field label={t('ownerWeb.to')} type="date" value={to} onChange={e => { setTo(e.target.value); setOffset(0); }} /></div><ResourceState resource={r} />
    <Panel><div className="table-scroll"><table><thead><tr><th>{t('customers')}</th><th>{t('jobType')}</th><th>{t('when')}</th><th>{t('assignee')}</th><th>{t('ownerWeb.status')}</th></tr></thead><tbody>{r.data?.items.map(j => <tr key={j.id}><td><Button kind="link" onClick={() => go({ section: 'job', id: j.id })}>{j.customer_name || j.customer_phone || '—'}<span className="muted"> · {j.location_label}</span></Button></td><td>{statusText(lang, 'jobType', j.job_type)}</td><td>{dateTime(j.scheduled_start, lang)}</td><td>{j.assignee_name || t('unassignedOption')}</td><td><span className={`pill ${j.status === 'completed' ? 'ok' : j.status === 'cancelled' ? 'bad' : 'info'}`}>{statusText(lang, 'status', j.status)}</span></td></tr>)}</tbody></table></div>{r.data && !r.data.items.length ? <Empty /> : null}<Pagination offset={offset} size={50} more={!!r.data?.has_more} busy={r.loading} onPage={setOffset} /></Panel></>;
}
/** Overlaps found when a job was just created; shown once on that job's page instead of an alert. */
let createdWarning: { jobId: string; count: number } | null = null;
const bangkokDay = (offsetDays = 0) => new Date(Date.now() + 7 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);
/** Two columns on wide screens: the form, and what the owner needs to know about this customer
 * (map, open jobs, service history). Pickers search as you type because a shop can have
 * thousands of customers. */
export function JobForm({ org, customerId: initialCustomer, locationId: initialLocation, memberId, go }: { org: string; customerId?: string; locationId?: string; memberId: string; go: Go }) {
  const t = useText(), lang = useContext(LanguageContext), a = useAction();
  const key = useRef<string | null>(null), [customerId, setCustomerId] = useState(initialCustomer ?? ''), [picked, setPicked] = useState<PickOption | null>(null), [locationId, setLocationId] = useState(initialLocation ?? '');
  const [type, setType] = useState('repair'), [description, setDescription] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState(''), [estimate, setEstimate] = useState(''), [assignee, setAssignee] = useState(''), [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState<string | null>(null), [addingLocation, setAddingLocation] = useState(false), [addingCoordinates, setAddingCoordinates] = useState(false);
  const team = useResource(() => api.team(org), [org]);
  const customer = useResource(async () => customerId ? api.customer(org, customerId) : null, [org, customerId]);
  const equipment = useResource(async () => locationId ? api.equipmentList(org, locationId) : { items: [] }, [org, locationId]);
  const c = customer.data?.id === customerId ? customer.data : null, location = c?.locations.find(l => l.id === locationId) ?? null;
  useEffect(() => { if (c && !locationId && c.locations.length === 1) setLocationId(c.locations[0]!.id); }, [c, locationId]);
  const phone = (v: string | null) => v ? formatPhone(v) : null;
  const customerOption = (o: CustomerSummary): PickOption => ({ value: o.id, label: o.name || phone(o.phone_normalized) || '—',
    detail: [o.name ? phone(o.phone_normalized) : null, o.first_address, o.location_count > 1 ? `${t('ownerWeb.locations')} ${o.location_count}` : null].filter(Boolean).join(' · ') || null });
  const chosenCustomer = !customerId ? null : picked?.value === customerId ? picked : c ? { value: c.id, label: c.name || phone(c.phone_normalized) || '—', detail: c.name ? phone(c.phone_normalized) : null } : null;
  function chooseCustomer(o: PickOption | null) { setPicked(o); setCustomerId(o?.value ?? ''); setLocationId(''); setSelected([]); setCreating(null); setAddingLocation(false); setAddingCoordinates(false); }
  function chooseLocation(id: string) { setLocationId(id); setSelected([]); setAddingCoordinates(false); }
  const locationOptions: PickOption[] = c?.locations.map(l => ({ value: l.id, label: l.label, detail: [l.address, l.latitude === null ? t('ownerWeb.no_coordinates') : null].filter(Boolean).join(' · ') || null })) ?? [];
  const memberOptions = useTeamOptions(team.data?.members, memberId);
  const units = equipment.data?.items ?? [], timeError = !!start && !!end && end <= start;
  const missing = [!customerId ? t('ownerWeb.needCustomer') : '', !locationId ? t('ownerWeb.needLocation') : ''].filter(Boolean);
  async function refreshCustomer(pickNew = false) {
    const before = new Set(c?.locations.map(l => l.id)), fresh = await api.customer(org, customerId); customer.setData(fresh);
    const added = fresh.locations.find(l => !before.has(l.id)); if (pickNew && added) chooseLocation(added.id);
  }
  return <><Button onClick={() => go({ section: 'jobs' })}>← {t('jobs')}</Button><PageTitle>{t('createJob')}</PageTitle><ResourceState resource={team} /><ResourceState resource={customer} />
    <div className="job-create"><div className="job-create-main">
      <Panel><SearchSelect label={t('customers')} selected={chosenCustomer} onSelect={chooseCustomer} placeholder={t('ownerWeb.searchCustomerHint')}
        load={async q => (await api.customers(org, q, 0, 20)).items.map(customerOption)}
        footer={(q, close) => <Button onClick={() => { close(); setCreating(q); }}>{q ? t('ownerWeb.addNewCustomerNamed', { q }) : t('ownerWeb.addNewCustomer')}</Button>} />
        {creating !== null ? <CustomerEditor org={org} prefill={creating} onCancel={() => setCreating(null)}
          onDone={saved => chooseCustomer({ value: saved.id, label: saved.name || phone(saved.phone_normalized) || '—', detail: saved.name ? phone(saved.phone_normalized) : null })} /> : null}
        {c && !c.locations.length && !addingLocation ? <div className="warn-box"><p>{t('ownerWeb.noLocationsYet')}</p><Button kind="primary" onClick={() => setAddingLocation(true)}>{t('ownerWeb.add_location')}</Button></div> : null}
        {c && c.locations.length ? <SearchSelect label={t('ownerWeb.location')} selected={locationOptions.find(o => o.value === locationId) ?? null} options={locationOptions}
          clearable={c.locations.length > 1} onSelect={o => chooseLocation(o?.value ?? '')} placeholder={t('ownerWeb.choose_a_location')}
          footer={(_, close) => <Button onClick={() => { close(); setAddingLocation(true); }}>+ {t('ownerWeb.add_location')}</Button>} /> : null}
        {addingLocation && c ? <LocationEditor org={org} customerId={c.id} onCancel={() => setAddingLocation(false)} onDone={() => { setAddingLocation(false); void refreshCustomer(true); }} /> : null}
      </Panel>
      <Panel><form onSubmit={e => { e.preventDefault(); if (missing.length || timeError) return; void a.run(async () => {
        const result = await api.createJob(org, { request_key: key.current ?? (key.current = uuid()), customer_id: customerId, location_id: locationId, job_type: type, description: description.trim() || undefined,
          scheduled_start: toInstant(start), scheduled_end: toInstant(end), estimated_equipment_count: units.length ? selected.length || null : estimate ? Number(estimate) : null, assignee_member_id: assignee || null, equipment_ids: selected });
        if (result.conflicts.length) createdWarning = { jobId: result.job.id, count: result.conflicts.length };
        go({ section: 'job', id: result.job.id });
      }); }}>
        <Chips label={t('jobType')} value={type} onChange={setType} options={jobTypes.map(v => ({ value: v, label: statusText(lang, 'jobType', v) }))} />
        <Note label={t('jobDescription')} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} />
        {locationId ? <><ResourceState resource={equipment} />{units.length ? <EquipmentPicker items={units} selected={selected} onChange={setSelected} />
          : equipment.data ? <><p className="muted">{t('ownerWeb.noEquipmentHint')}</p><Field label={t('estimatedCount')} type="number" min={1} max={999} value={estimate} onChange={e => setEstimate(e.target.value)} /></> : null}</> : null}
        <p className="muted">{t('ownerWeb.appointments_use_bangkok_time_dates_are_optional')}</p><div className="grid2"><Field label={t('ownerWeb.appointment_start')} type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /><Field label={t('ownerWeb.appointment_end')} type="datetime-local" min={start || undefined} value={end} onChange={e => setEnd(e.target.value)} /></div>
        {timeError ? <Notice error>{t('ownerWeb.endBeforeStart')}</Notice> : null}
        <SearchSelect label={t('assignee')} selected={memberOptions.find(o => o.value === assignee) ?? null} options={memberOptions} onSelect={o => setAssignee(o?.value ?? '')} placeholder={t('unassignedOption')} />
        <ActionState action={a} />{missing.length ? <p className="muted">{t('ownerWeb.stillNeeded', { items: missing.join(', ') })}</p> : null}
        <Button type="submit" kind="primary" busy={a.busy} disabled={!!missing.length || timeError}>{assignee ? t('createAndAssign') : t('createUnassigned')}</Button></form></Panel>
    </div><aside className="job-create-context">{!c ? <Panel><p className="muted">{t('ownerWeb.pickCustomerFirst')}</p></Panel> : <>
      <Panel title={t('ownerWeb.customerInfo')}><p><Button kind="link" onClick={() => go({ section: 'customer', id: c.id })}><strong>{c.name || phone(c.phone_normalized)}</strong></Button>
        {c.phone_normalized ? <> · <a href={`tel:${c.phone_normalized}`}>{phone(c.phone_normalized)}</a></> : null}</p>{c.note ? <p className="muted">{c.note}</p> : null}
        {location ? <><h3>{location.label}</h3>{location.address ? <p>{location.address}</p> : null}{location.travel_note ? <p className="muted">{location.travel_note}</p> : null}
          {location.latitude !== null && location.longitude !== null ? <LocationMap latitude={location.latitude} longitude={location.longitude} />
            : <div className="warn-box"><p>{t('ownerWeb.noCoordinatesHint')}</p>{!addingCoordinates ? <Button onClick={() => setAddingCoordinates(true)}>{t('ownerWeb.addCoordinates')}</Button> : null}</div>}
          {addingCoordinates && location.latitude === null ? <CoordinatesForm key={location.version} org={org} location={location} onSaved={async () => { await refreshCustomer(); setAddingCoordinates(false); }} /> : null}</> : null}
      </Panel>
      <CustomerHistoryPanel key={c.id} org={org} customerId={c.id} locationId={locationId || undefined} locationCount={c.locations.length} go={go} /></>}
    </aside></div></>;
}
/** Equipment at the location as photo cards; tap to include in the plan. Due dates help the owner
 * add units that are about to need service anyway. */
function EquipmentPicker({ items, selected, onChange }: { items: EquipmentSummary[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const t = useText(), lang = useContext(LanguageContext), name = useEquipmentName(), [q, setQ] = useState('');
  const today = bangkokDay(), soon = bangkokDay(30), query = q.trim().toLocaleLowerCase('th');
  const shown = query ? items.filter(e => `${name(e)} ${e.brand ?? ''} ${e.model ?? ''} ${e.serial_number ?? ''}`.toLocaleLowerCase('th').includes(query)) : items;
  return <fieldset className="equipment-pick"><legend>{t('plannedEquipment')}{selected.length ? <span className="muted"> · {t('ownerWeb.selectedCount', { n: selected.length })}</span> : null}</legend>
    {items.length > 6 ? <input type="search" aria-label={t('ownerWeb.searchEquipment')} placeholder={t('ownerWeb.searchEquipment')} value={q} onChange={e => setQ(e.target.value)} /> : null}
    <div className="actions"><Button onClick={() => onChange(Array.from(new Set([...selected, ...shown.map(e => e.id)])))}>{t('ownerWeb.selectAll')}</Button>{selected.length ? <Button onClick={() => onChange([])}>{t('ownerWeb.clearAll')}</Button> : null}</div>
    <div className="equipment-grid">{shown.map(e => { const on = selected.includes(e.id); return <label key={e.id} className={`equipment-card pick${on ? ' on' : ''}`}>
      <input type="checkbox" checked={on} onChange={ev => onChange(ev.target.checked ? [...selected, e.id] : selected.filter(id => id !== e.id))} />
      {e.thumbnail_url ? <img src={e.thumbnail_url} alt="" /> : <span className="equipment-placeholder">◇</span>}<strong>{name(e)}</strong><span className="muted">{e.serial_number || '—'}</span>
      {e.next_due_on ? <span className={`pill ${e.next_due_on < today ? 'bad' : e.next_due_on <= soon ? 'warn' : ''}`}>{t(e.next_due_on < today ? 'ownerWeb.overdueSince' : e.next_due_on <= soon ? 'ownerWeb.dueOn' : 'ownerWeb.nextDue', { date: dayText(e.next_due_on, lang) })}</span> : null}
      {e.last_serviced_at ? <span className="muted small">{t('ownerWeb.lastServiced', { date: dayText(fromInstant(e.last_serviced_at).slice(0, 10), lang) })}</span> : null}
    </label>; })}</div></fieldset>;
}
export function JobView({ membership: m, id, go }: { membership: Membership; id: string; go: Go }) {
  const org = m.organization_id, t = useText(), lang = useContext(LanguageContext), a = useAction();
  const r = useResource(() => api.job(org, id), [org, id]), team = useResource(() => api.team(org), [org]), teamOptions = useTeamOptions(team.data?.members, m.member_id);
  const conflicts = useRef(createdWarning?.jobId === id ? createdWarning.count : 0);
  useEffect(() => { if (createdWarning?.jobId === id) createdWarning = null; }, [id]);
  const [assignee, setAssignee] = useState(''), [reason, setReason] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState('');
  const j = r.data;
  useEffect(() => { if (j) { setAssignee(j.current_assignee_id ?? ''); setStart(fromInstant(j.scheduled_start)); setEnd(fromInstant(j.scheduled_end)); } }, [j?.version]);
  async function act(action: 'assign' | 'unassign' | 'reschedule' | 'cancel' | 'start', body: Record<string, unknown> = {}) {
    if (!j) return;
    await a.run(async () => {
      try { const result = await api.jobAction(org, id, action, { expected_version: j.version, ...body }); if ('job' in result) { r.setData(result.job); if (result.conflicts.length) window.alert(t('conflictWarning', { count: result.conflicts.length })); } else r.setData(result); }
      catch (e) { await r.reload(); throw e; }
    }, t('saved'));
  }
  // No separate Start button: recording starts a scheduled job first (the server needs in_progress
  // for started_at and photo uploads), then opens the service form.
  async function recordService() {
    if (!j) return;
    let ready = j.status === 'in_progress';
    if (!ready) await a.run(async () => {
      try { const result = await api.jobAction(org, id, 'start', { expected_version: j.version }); r.setData('job' in result ? result.job : result); ready = true; }
      catch (e) { await r.reload(); throw e; }
    });
    if (ready) go({ section: 'service', id });
  }
  return <><Button onClick={() => go({ section: 'jobs' })}>← {t('jobs')}</Button><ResourceState resource={r} /><ResourceState resource={team} /><ActionState action={a} />{conflicts.current ? <div className="warn-box" role="alert"><p>{t('conflictWarning', { count: conflicts.current })}</p></div> : null}{j ? <><PageTitle>{statusText(lang, 'jobType', j.job_type)} · {j.customer_name || j.customer_phone}</PageTitle><Panel><p><span className="pill">{statusText(lang, 'status', j.status)}</span> · {dateTime(j.scheduled_start, lang)}</p><p>{j.description}</p><p>{j.location_label} · {j.location_address}</p><p>{j.travel_note}</p><p>{j.assignee_name || t('unassignedOption')}</p><Button onClick={() => go({ section: 'customer', id: j.customer_id })}>{t('customers')}</Button>
    {j.latitude !== null && j.longitude !== null ? <LocationMap latitude={j.latitude} longitude={j.longitude} /> : <p className="muted">{t('ownerWeb.no_coordinates')}</p>}
    <h3>{t('plannedEquipment')}</h3>{j.equipment.map(e => <p key={e.id}><Button kind="link" onClick={() => go({ section: 'equipment', id: e.id })}>{e.name || [statusText(lang, 'category', e.category), e.brand, e.model].filter(Boolean).join(' ')} · {e.serial_number}</Button></p>)}
    {j.current_assignee_id === m.member_id && (j.status === 'scheduled' || j.status === 'in_progress') ? <Button kind="primary" busy={a.busy} onClick={() => { void recordService(); }}>{t('recordService')}</Button> : null}</Panel>
    {['unassigned', 'scheduled', 'in_progress'].includes(j.status) ? <div className="grid2"><Panel title={t('assignee')}><SearchSelect label={t('assignee')} selected={teamOptions.find(o => o.value === assignee) ?? null} options={teamOptions} placeholder={t('unassignedOption')} onSelect={o => setAssignee(o?.value ?? '')} /><Note label={t('reasonLabel')} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} /><div className="actions"><Button kind="primary" busy={a.busy} disabled={!assignee || j.status === 'in_progress' && !reason.trim()} onClick={() => act('assign', { assignee_member_id: assignee, reason: reason.trim() || undefined })}>{t('assign')}</Button>{j.status === 'scheduled' ? <Button busy={a.busy} onClick={() => act('unassign')}>{t('unassign')}</Button> : null}</div></Panel>
    <Panel title={t('reschedule')}><form onSubmit={e => { e.preventDefault(); void act('reschedule', { scheduled_start: toInstant(start), scheduled_end: toInstant(end) }); }}><Field label={t('ownerWeb.start_bangkok_time')} type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /><Field label={t('ownerWeb.end_bangkok_time')} type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /><Button kind="primary" type="submit" busy={a.busy}>{t('save')}</Button></form><h3>{t('cancelJob')}</h3><p>{t('cancelReason')}</p><Button kind="danger" disabled={!reason.trim()} busy={a.busy} onClick={() => { if (window.confirm(t('cancelJob'))) void act('cancel', { reason: reason.trim() }); }}>{t('cancelJob')}</Button></Panel></div> : null}
    {['unassigned', 'scheduled', 'in_progress'].includes(j.status) ? <JobPlanEditor key={j.version} org={org} job={j} onDone={saved => r.setData(saved)} /> : null}
    <Panel title={t('history')}>{j.history.map((h, i) => <div className="history-entry" key={i}><strong>{statusText(lang, 'status', h.to_status)}</strong><p className="muted">{dateTime(h.created_at, lang)} · {h.actor} · {h.reason}</p></div>)}</Panel></> : null}</>;
}
function JobPlanEditor({ org, job, onDone }: { org: string; job: Job; onDone: (job: Job) => void }) {
  const t = useText(), lang = useContext(LanguageContext), a = useAction(), name = useEquipmentName();
  const [open, setOpen] = useState(false), [type, setType] = useState(job.job_type), [description, setDescription] = useState(job.description ?? ''), [estimate, setEstimate] = useState(job.estimated_equipment_count?.toString() ?? ''), [selected, setSelected] = useState(job.equipment.map(e => e.id));
  const r = useResource(() => api.equipmentList(org, job.location_id), [org, job.location_id]);
  return <Panel title={t('ownerWeb.edit_job_plan')}><Button onClick={() => setOpen(!open)}>{t('edit')}</Button>{open ? <form onSubmit={e => { e.preventDefault(); void a.run(async () => { onDone(await api.updateJob(org, job.id, { expected_version: job.version, job_type: type, description, estimated_equipment_count: estimate ? Number(estimate) : null, equipment_ids: selected })); }); }}><ResourceState resource={r} /><Chips label={t('jobType')} value={type} onChange={setType} options={jobTypes.map(v => ({ value: v, label: statusText(lang, 'jobType', v) }))} /><Note label={t('jobDescription')} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} /><Field label={t('estimatedCount')} type="number" min={1} max={999} value={estimate} onChange={e => setEstimate(e.target.value)} /><fieldset className="checks"><legend>{t('plannedEquipment')}</legend>{r.data?.items.map(unit => <label className="check" key={unit.id}><input type="checkbox" checked={selected.includes(unit.id)} onChange={e => setSelected(e.target.checked ? [...selected, unit.id] : selected.filter(id => id !== unit.id))} />{name(unit)}</label>)}</fieldset><Button type="submit" kind="primary" busy={a.busy}>{t('save')}</Button><ActionState action={a} /></form> : null}</Panel>;
}
interface Draft { body: ServiceBody; expectedVersion?: number; frozen: boolean; savedAt: number }
const draftAge = 7 * 86400000;
export function ServiceForm({ membership: m, jobId, customerId, locationId, go }: { membership: Membership; jobId?: string; customerId?: string; locationId?: string; go: Go }) {
  const org = m.organization_id, t = useText(), lang = useContext(LanguageContext), a = useAction(), name = useEquipmentName();
  const r = useResource(async () => { const job = jobId ? await api.job(org, jobId) : null; const loc = job?.location_id ?? locationId; if (!loc) throw new Error('location required'); const units = await api.equipmentList(org, loc); return { job, units: units.items, loc }; }, [org, jobId, locationId]);
  const draftKey = `shop.draft.${org}.${m.member_id}.${jobId ?? `adhoc.${locationId}`}`;
  const [draft, setDraft] = useState<Draft | null>(null), [restored, setRestored] = useState(false), [storageError, setStorageError] = useState(false), [result, setResult] = useState<ServiceResult | null>(null);
  const [uploads, setUploads] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!r.data || draft) return;
    try { const saved = JSON.parse(localStorage.getItem(draftKey) || 'null') as Draft | null;
      if (saved && Date.now() - saved.savedAt < draftAge && saved.body?.client_event_id && Array.isArray(saved.body.items)) { setDraft(saved); setRestored(true); return; }
      localStorage.removeItem(draftKey);
    } catch { setStorageError(true); }
    const planned = r.data.job?.equipment.map(e => e.id) ?? [];
    setDraft({ savedAt: Date.now(), frozen: false, expectedVersion: r.data.job?.version, body: { client_event_id: uuid(), occurred_at: new Date().toISOString(), note: '', items: planned.map(equipment_id => ({ equipment_id, service_type: r.data!.job!.job_type === 'installation' ? 'installation' : r.data!.job!.job_type, outcome: 'done', photos: [] })) } });
  }, [r.data, draft, draftKey]);
  useEffect(() => { if (!draft || result) return; try { localStorage.setItem(draftKey, JSON.stringify(draft)); setStorageError(false); } catch { setStorageError(true); } }, [draft, draftKey, result]);
  function updateBody(patch: Partial<ServiceBody>) { setDraft(d => d && !d.frozen ? { ...d, savedAt: Date.now(), body: { ...d.body, ...patch } } : d); }
  function updateItem(id: string, patch: Partial<ServiceItemInput>) { setDraft(d => d && !d.frozen ? { ...d, savedAt: Date.now(), body: { ...d.body, items: d.body.items.map(i => i.equipment_id === id ? { ...i, ...patch } : i) } } : d); }
  async function submit() {
    if (!draft || !r.data || uploads.size) return;
    const ready: Draft = { ...draft, frozen: true, savedAt: Date.now() }; setDraft(ready);
    // Freeze and persist the exact command before sending. A lost response can safely replay it.
    try { localStorage.setItem(draftKey, JSON.stringify(ready)); } catch { setStorageError(true); }
    await a.run(async () => {
      try {
        const response = jobId ? await api.completeJob(org, jobId, { ...ready.body, expected_version: ready.expectedVersion! }) : await api.recordAdhoc(org, { ...ready.body, customer_id: customerId!, location_id: r.data!.loc });
        setResult(response); try { localStorage.removeItem(draftKey); } catch { /* confirmation remains visible */ }
      } catch (e) {
        // The server checks committed event replay before the job version. A version conflict
        // therefore has no committed event; reload current assignment before permitting edits.
        if (jobId && e instanceof ApiFailure && e.code === 'VERSION_CONFLICT') {
          const latest = await api.job(org, jobId); await r.reload();
          setDraft(d => d ? { ...d, expectedVersion: latest.version, frozen: false } : d);
        }
        throw e;
      }
    });
  }
  // Validation failures have no committed record, so allow correction. Unknown/network failures keep
  // the command frozen until its original result can be recovered, rather than creating a second event.
  useEffect(() => { const error = a.error as { status?: number; code?: string } | null;
    if (error?.status && error.status < 500 && !['IDEMPOTENCY_MISMATCH', 'VERSION_CONFLICT'].includes(error.code ?? '')) setDraft(d => d ? { ...d, frozen: false } : d);
  }, [a.error]);
  if (result) return <><PageTitle>{t('jobFinished')}</PageTitle><Panel><Notice>{t('saved')}</Notice>{result.items.map(i => <p key={i.equipment_id}>{name(r.data!.units.find(e => e.id === i.equipment_id)!)} · {statusText(lang, 'outcome', i.outcome)} · {i.next_due_on || '—'}</p>)}<Button kind="primary" onClick={() => go({ section: 'job', id: result.job_id })}>{t('openJob')}</Button></Panel></>;
  const locked = draft?.frozen || a.busy;
  const allowed = !r.data?.job || r.data.job.current_assignee_id === m.member_id && r.data.job.status === 'in_progress';
  return <><Button onClick={() => go(jobId ? { section: 'job', id: jobId } : { section: 'customer', id: customerId })}>← {t('back')}</Button><PageTitle>{jobId ? t('recordService') : t('recordAdhoc')}</PageTitle><ResourceState resource={r} />
    {!allowed && !draft?.frozen ? <Notice error>{t('ownerWeb.only_the_current_assignee_can_record_an_in_progress')}</Notice> : null}
    {restored ? <Notice>{t('ownerWeb.your_saved_draft_on_this_device_has_been_restored')}</Notice> : null}{storageError ? <Notice error>{t('ownerWeb.the_draft_cannot_be_saved_on_this_device_keep')}</Notice> : null}
    {draft?.frozen ? <Notice>{t('ownerWeb.the_submitted_record_is_retained_retry_to_recover_the')}</Notice> : null}
    {draft && r.data ? <form onSubmit={e => { e.preventDefault(); void submit(); }}><fieldset disabled={!!locked || !allowed} className="service-fieldset">
      {r.data.units.map(unit => { const item = draft.body.items.find(i => i.equipment_id === unit.id); return <Panel key={unit.id}><label className="check"><input type="checkbox" checked={!!item} onChange={e => updateBody({ items: e.target.checked ? [...draft.body.items, { equipment_id: unit.id, service_type: 'maintenance', outcome: 'done', photos: [] }] : draft.body.items.filter(i => i.equipment_id !== unit.id) })} /><strong>{name(unit)}</strong></label>
        {item ? <><div className="grid2"><Select label={t('serviceType')} value={item.service_type} onChange={e => updateItem(unit.id, { service_type: e.target.value })}>{jobTypes.map(type => <option key={type} value={type}>{statusText(lang, 'jobType', type)}</option>)}</Select><Select label={t('outcome')} value={item.outcome} onChange={e => updateItem(unit.id, { outcome: e.target.value as ServiceItemInput['outcome'] })}>{['done', 'not_done', 'deferred'].map(o => <option key={o} value={o}>{statusText(lang, 'outcome', o)}</option>)}</Select></div>
          {item.outcome !== 'done' ? <Field label={t('notDoneReason')} required maxLength={500} value={item.not_done_reason ?? ''} onChange={e => updateItem(unit.id, { not_done_reason: e.target.value })} /> : null}<Note label={t('problemNote')} maxLength={2000} value={item.problem_note ?? ''} onChange={e => updateItem(unit.id, { problem_note: e.target.value })} /><Note label={t('workNote')} maxLength={2000} value={item.work_note ?? ''} onChange={e => updateItem(unit.id, { work_note: e.target.value })} />
          <div className="grid2">{(['before', 'after'] as const).map(kind => <div key={kind}><PhotoUpload org={org} purpose="service" label={t(kind === 'before' ? 'beforePhoto' : 'afterPhoto')} onBusy={busy => setUploads(current => { const next = new Set(current); if (busy) next.add(`${unit.id}:${kind}`); else next.delete(`${unit.id}:${kind}`); return next; })} onReady={media => setDraft(d => d && !d.frozen ? { ...d, savedAt: Date.now(), body: { ...d.body, items: d.body.items.map(i => i.equipment_id === unit.id ? { ...i, photos: [...i.photos, { media_asset_id: media.id, photo_type: kind }] } : i) } } : d)} /><p className="muted">{t('ownerWeb.photos_in_draft')}: {item.photos.filter(p => p.photo_type === kind).length}</p></div>)}</div>
          {item.outcome === 'done' ? <><Select label={t('nextMaintenance')} value={!item.next_maintenance ? 'keep' : item.next_maintenance.mode === 'months' ? String(item.next_maintenance.interval_months) : item.next_maintenance.mode} onChange={e => updateItem(unit.id, { next_maintenance: e.target.value === 'keep' ? null : e.target.value === 'none' ? { mode: 'none' } : e.target.value === 'custom_date' ? { mode: 'custom_date', due_on: '' } : { mode: 'months', interval_months: Number(e.target.value) } })}>
            <option value="keep">{t('keepSchedule')}</option>{[3, 6, 12].map(n => <option key={n} value={n}>{t('months', { n })}</option>)}<option value="custom_date">{t('ownerWeb.choose_a_date')}</option><option value="none">{t('noReminder')}</option></Select>{item.next_maintenance?.mode === 'custom_date' ? <Field label={t('newDueDate')} type="date" required value={item.next_maintenance.due_on} onChange={e => updateItem(unit.id, { next_maintenance: { mode: 'custom_date', due_on: e.target.value } })} /> : null}</> : null}
        </> : null}</Panel>; })}<Note label={t('serviceNote')} maxLength={2000} value={draft.body.note ?? ''} onChange={e => updateBody({ note: e.target.value })} /></fieldset><ActionState action={a} /><Button kind="primary" busy={a.busy} type="submit" disabled={uploads.size > 0 || !draft.body.items.some(i => i.outcome === 'done') || !allowed && !draft.frozen}>{draft.frozen ? t('retry') : jobId ? t('finishJob') : t('recordService')}</Button></form> : null}</>;
}
