'use client';
import { useContext, useEffect, useRef, useState } from 'react';
import { api, ApiFailure, type Job, type Membership, type ServiceBody, type ServiceItemInput, type ServiceResult } from './api';
import type { Go } from './OwnerApp';
import { ActionState, Button, dateTime, Empty, Field, fromInstant, LanguageContext, Note, Notice, PageTitle, Panel, Pagination, PhotoUpload, ResourceState, Select, statusText, toInstant, useAction, useResource, useText, uuid } from './ui';
import { useEquipmentName } from './customers';
const jobTypes = ['maintenance', 'repair', 'installation', 'inspection', 'other'];
export function JobsView({ org, go }: { org: string; go: Go }) {
  const t = useText(), lang = useContext(LanguageContext);
  const [status, setStatus] = useState(''), [assignee, setAssignee] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [offset, setOffset] = useState(0);
  const team = useResource(() => api.team(org), [org]);
  const r = useResource(() => api.jobs(org, { limit: '50', offset: String(offset), status: status || 'unassigned,scheduled,in_progress,completed,cancelled', assignee, from: from ? toInstant(`${from}T00:00`) ?? undefined : '2000-01-01T00:00:00+07:00', to: to ? toInstant(`${to}T23:59`) ?? undefined : '2100-01-01T00:00:00+07:00' }), [org, status, assignee, from, to, offset]);
  return <><PageTitle action={<Button kind="primary" onClick={() => go({ section: 'jobNew' })}>{t('createJob')}</Button>}>{t('jobs')}</PageTitle><div className="filter-grid">
    <Select label={t('ownerWeb.status')} value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}><option value="">{t('ownerWeb.all')}</option>{['unassigned', 'scheduled', 'in_progress', 'completed', 'cancelled'].map(s => <option key={s} value={s}>{statusText(lang, 'status', s)}</option>)}</Select>
    <Select label={t('assignee')} value={assignee} onChange={e => { setAssignee(e.target.value); setOffset(0); }}><option value="">{t('ownerWeb.all')}</option>{team.data?.members.filter(m => m.status === 'active').map(m => <option key={m.member_id} value={m.member_id}>{m.display_name}</option>)}</Select>
    <Field label={t('ownerWeb.from')} type="date" value={from} onChange={e => { setFrom(e.target.value); setOffset(0); }} /><Field label={t('ownerWeb.to')} type="date" value={to} onChange={e => { setTo(e.target.value); setOffset(0); }} /></div><ResourceState resource={r} />
    <Panel><div className="table-scroll"><table><thead><tr><th>{t('customers')}</th><th>{t('jobType')}</th><th>{t('when')}</th><th>{t('assignee')}</th><th>{t('ownerWeb.status')}</th></tr></thead><tbody>{r.data?.items.map(j => <tr key={j.id}><td><Button kind="link" onClick={() => go({ section: 'job', id: j.id })}>{j.customer_name || j.customer_phone || '—'}<span className="muted"> · {j.location_label}</span></Button></td><td>{statusText(lang, 'jobType', j.job_type)}</td><td>{dateTime(j.scheduled_start, lang)}</td><td>{j.assignee_name || t('unassignedOption')}</td><td><span className={`pill ${j.status === 'completed' ? 'ok' : j.status === 'cancelled' ? 'bad' : 'info'}`}>{statusText(lang, 'status', j.status)}</span></td></tr>)}</tbody></table></div>{r.data && !r.data.items.length ? <Empty /> : null}<Pagination offset={offset} size={50} more={!!r.data?.has_more} busy={r.loading} onPage={setOffset} /></Panel></>;
}
export function JobForm({ org, customerId: initialCustomer, locationId: initialLocation, memberId, go }: { org: string; customerId?: string; locationId?: string; memberId: string; go: Go }) {
  const t = useText(), lang = useContext(LanguageContext), a = useAction(), name = useEquipmentName();
  const key = useRef<string | null>(null), [customerId, setCustomerId] = useState(initialCustomer ?? ''), [locationId, setLocationId] = useState(initialLocation ?? ''), [type, setType] = useState('repair'), [description, setDescription] = useState(''), [start, setStart] = useState(''), [end, setEnd] = useState(''), [estimate, setEstimate] = useState(''), [assignee, setAssignee] = useState(''), [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const customers = useResource(() => api.customers(org, search), [org, search]), team = useResource(() => api.team(org), [org]);
  const customer = useResource(async () => customerId ? api.customer(org, customerId) : null, [org, customerId]);
  const equipment = useResource(async () => locationId ? api.equipmentList(org, locationId) : { items: [] }, [org, locationId]);
  return <><Button onClick={() => go({ section: 'jobs' })}>← {t('jobs')}</Button><PageTitle>{t('createJob')}</PageTitle><ResourceState resource={customers} /><ResourceState resource={team} /><ResourceState resource={customer} /><ResourceState resource={equipment} />
    <Panel><Field label={t('ownerWeb.find_a_customer_before_selecting')} value={search} onChange={e => setSearch(e.target.value)} /><form onSubmit={e => { e.preventDefault(); void a.run(async () => { const result = await api.createJob(org, { request_key: key.current ?? (key.current = uuid()), customer_id: customerId, location_id: locationId, job_type: type, description: description.trim() || undefined, scheduled_start: toInstant(start), scheduled_end: toInstant(end), estimated_equipment_count: estimate ? Number(estimate) : null, assignee_member_id: assignee || null, equipment_ids: selected });
      if (result.conflicts.length) window.alert(t('conflictWarning', { count: result.conflicts.length })); go({ section: 'job', id: result.job.id });
    }); }}><div className="grid2"><Select label={t('customers')} required value={customerId} onChange={e => { setCustomerId(e.target.value); setLocationId(''); setSelected([]); }}><option value="">{t('ownerWeb.choose_a_customer')}</option>{customer.data && !customers.data?.items.some(c => c.id === customerId) ? <option value={customerId}>{customer.data.name || customer.data.phone_normalized}</option> : null}{customers.data?.items.map(c => <option key={c.id} value={c.id}>{c.name || c.phone_normalized}</option>)}</Select>
      <Select label={t('ownerWeb.location')} required value={locationId} onChange={e => { setLocationId(e.target.value); setSelected([]); }}><option value="">{t('ownerWeb.choose_a_location')}</option>{customer.data?.locations.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}</Select></div>
      <Select label={t('jobType')} value={type} onChange={e => setType(e.target.value)}>{jobTypes.map(type => <option key={type} value={type}>{statusText(lang, 'jobType', type)}</option>)}</Select><Note label={t('jobDescription')} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} />
      <p className="muted">{t('ownerWeb.appointments_use_bangkok_time_dates_are_optional')}</p><div className="grid2"><Field label={t('ownerWeb.appointment_start')} type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /><Field label={t('ownerWeb.appointment_end')} type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></div>
      <Select label={t('assignee')} value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">{t('unassignedOption')}</option>{team.data?.members.filter(m => m.status === 'active').map(m => <option key={m.member_id} value={m.member_id}>{m.member_id === memberId ? t('doItMyself') : m.display_name}</option>)}</Select>
      <fieldset className="checks"><legend>{t('plannedEquipment')}</legend>{equipment.data?.items.map(unit => <label className="check" key={unit.id}><input type="checkbox" checked={selected.includes(unit.id)} onChange={e => setSelected(e.target.checked ? [...selected, unit.id] : selected.filter(id => id !== unit.id))} />{name(unit)}</label>)}</fieldset><Field label={t('estimatedCount')} type="number" min={1} max={999} value={estimate} onChange={e => setEstimate(e.target.value)} /><ActionState action={a} /><Button type="submit" kind="primary" busy={a.busy} disabled={!customerId || !locationId}>{assignee ? t('createAndAssign') : t('createUnassigned')}</Button></form></Panel></>;
}
export function JobView({ membership: m, id, go }: { membership: Membership; id: string; go: Go }) {
  const org = m.organization_id, t = useText(), lang = useContext(LanguageContext), a = useAction();
  const r = useResource(() => api.job(org, id), [org, id]), team = useResource(() => api.team(org), [org]);
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
  return <><Button onClick={() => go({ section: 'jobs' })}>← {t('jobs')}</Button><ResourceState resource={r} /><ResourceState resource={team} /><ActionState action={a} />{j ? <><PageTitle>{statusText(lang, 'jobType', j.job_type)} · {j.customer_name || j.customer_phone}</PageTitle><Panel><p><span className="pill">{statusText(lang, 'status', j.status)}</span> · {dateTime(j.scheduled_start, lang)}</p><p>{j.description}</p><p>{j.location_label} · {j.location_address}</p><p>{j.travel_note}</p><p>{j.assignee_name || t('unassignedOption')}</p><Button onClick={() => go({ section: 'customer', id: j.customer_id })}>{t('customers')}</Button>
    {j.latitude !== null && j.longitude !== null ? <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${j.latitude},${j.longitude}`}>{t('ownerWeb.navigate')}</a> : null}
    <h3>{t('plannedEquipment')}</h3>{j.equipment.map(e => <p key={e.id}><Button kind="link" onClick={() => go({ section: 'equipment', id: e.id })}>{e.name || [statusText(lang, 'category', e.category), e.brand, e.model].filter(Boolean).join(' ')} · {e.serial_number}</Button></p>)}
    {j.current_assignee_id === m.member_id && (j.status === 'scheduled' || j.status === 'in_progress') ? <Button kind="primary" busy={a.busy} onClick={() => { void recordService(); }}>{t('recordService')}</Button> : null}</Panel>
    {['unassigned', 'scheduled', 'in_progress'].includes(j.status) ? <div className="grid2"><Panel title={t('assignee')}><Select label={t('assignee')} value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">{t('unassignedOption')}</option>{team.data?.members.filter(m => m.status === 'active').map(m => <option key={m.member_id} value={m.member_id}>{m.display_name}</option>)}</Select><Note label={t('reasonLabel')} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} /><div className="actions"><Button kind="primary" busy={a.busy} disabled={!assignee || j.status === 'in_progress' && !reason.trim()} onClick={() => act('assign', { assignee_member_id: assignee, reason: reason.trim() || undefined })}>{t('assign')}</Button>{j.status === 'scheduled' ? <Button busy={a.busy} onClick={() => act('unassign')}>{t('unassign')}</Button> : null}</div></Panel>
    <Panel title={t('reschedule')}><form onSubmit={e => { e.preventDefault(); void act('reschedule', { scheduled_start: toInstant(start), scheduled_end: toInstant(end) }); }}><Field label={t('ownerWeb.start_bangkok_time')} type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /><Field label={t('ownerWeb.end_bangkok_time')} type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /><Button kind="primary" type="submit" busy={a.busy}>{t('save')}</Button></form><h3>{t('cancelJob')}</h3><p>{t('cancelReason')}</p><Button kind="danger" disabled={!reason.trim()} busy={a.busy} onClick={() => { if (window.confirm(t('cancelJob'))) void act('cancel', { reason: reason.trim() }); }}>{t('cancelJob')}</Button></Panel></div> : null}
    {['unassigned', 'scheduled', 'in_progress'].includes(j.status) ? <JobPlanEditor key={j.version} org={org} job={j} onDone={saved => r.setData(saved)} /> : null}
    <Panel title={t('history')}>{j.history.map((h, i) => <div className="history-entry" key={i}><strong>{statusText(lang, 'status', h.to_status)}</strong><p className="muted">{dateTime(h.created_at, lang)} · {h.actor} · {h.reason}</p></div>)}</Panel></> : null}</>;
}
function JobPlanEditor({ org, job, onDone }: { org: string; job: Job; onDone: (job: Job) => void }) {
  const t = useText(), lang = useContext(LanguageContext), a = useAction(), name = useEquipmentName();
  const [open, setOpen] = useState(false), [type, setType] = useState(job.job_type), [description, setDescription] = useState(job.description ?? ''), [estimate, setEstimate] = useState(job.estimated_equipment_count?.toString() ?? ''), [selected, setSelected] = useState(job.equipment.map(e => e.id));
  const r = useResource(() => api.equipmentList(org, job.location_id), [org, job.location_id]);
  return <Panel title={t('ownerWeb.edit_job_plan')}><Button onClick={() => setOpen(!open)}>{t('edit')}</Button>{open ? <form onSubmit={e => { e.preventDefault(); void a.run(async () => { onDone(await api.updateJob(org, job.id, { expected_version: job.version, job_type: type, description, estimated_equipment_count: estimate ? Number(estimate) : null, equipment_ids: selected })); }); }}><ResourceState resource={r} /><Select label={t('jobType')} value={type} onChange={e => setType(e.target.value)}>{jobTypes.map(type => <option key={type} value={type}>{statusText(lang, 'jobType', type)}</option>)}</Select><Note label={t('jobDescription')} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} /><Field label={t('estimatedCount')} type="number" min={1} max={999} value={estimate} onChange={e => setEstimate(e.target.value)} /><fieldset className="checks"><legend>{t('plannedEquipment')}</legend>{r.data?.items.map(unit => <label className="check" key={unit.id}><input type="checkbox" checked={selected.includes(unit.id)} onChange={e => setSelected(e.target.checked ? [...selected, unit.id] : selected.filter(id => id !== unit.id))} />{name(unit)}</label>)}</fieldset><Button type="submit" kind="primary" busy={a.busy}>{t('save')}</Button><ActionState action={a} /></form> : null}</Panel>;
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
