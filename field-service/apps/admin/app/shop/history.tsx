'use client';
import { useContext, useState } from 'react';
import { formatDate } from '@field-service/i18n';
import { api, type CustomerHistory } from './api';
import type { Go } from './OwnerApp';
import { Button, Chips, dateTime, LanguageContext, Panel, ResourceState, statusText, useResource, useText } from './ui';

export const dayText = (day: string, lang: 'th' | 'en') => formatDate(new Date(`${day}T00:00:00+07:00`), lang);

/** Open jobs (so the owner does not book the same visit twice) and the service timeline of one
 * customer. Starts with the chosen location; "all locations" widens it when there is more than one. */
export function CustomerHistoryPanel({ org, customerId, locationId, locationCount, go, hideOpenJobs = false }: {
  org: string; customerId: string; locationId?: string; locationCount: number; go: Go; hideOpenJobs?: boolean;
}) {
  const t = useText(), lang = useContext(LanguageContext);
  const [scope, setScope] = useState<'location' | 'all'>('location');
  const narrowed = scope === 'location' && locationId ? locationId : undefined;
  const r = useResource(() => api.customerHistory(org, customerId, narrowed), [org, customerId, narrowed]);
  const [more, setMore] = useState(false);
  async function loadMore(page: CustomerHistory) {
    setMore(true);
    try { const next = await api.customerHistory(org, customerId, narrowed, page.items.length); r.setData({ ...next, items: [...page.items, ...next.items] }); } finally { setMore(false); }
  }
  const d = r.data, name = (e: CustomerHistory['items'][number]['equipment'][number]) => e.name || [statusText(lang, 'category', e.category), e.brand, e.model].filter(Boolean).join(' ');
  return <>
    {!hideOpenJobs && d?.open_jobs.length ? <div className="open-jobs" role="status"><strong>{t('ownerWeb.openJobsWarning', { n: d.open_jobs.length })}</strong>
      <ul>{d.open_jobs.map(j => <li key={j.id}><Button kind="link" onClick={() => go({ section: 'job', id: j.id })}>{statusText(lang, 'jobType', j.job_type)} · {j.scheduled_start ? dateTime(j.scheduled_start, lang) : t('ownerWeb.notScheduled')}</Button>
        <span className="pill">{statusText(lang, 'status', j.status)}</span>{j.assignee_name ? <span className="muted"> {j.assignee_name}</span> : null}</li>)}</ul></div> : null}
    <Panel title={t('ownerWeb.serviceHistory')}>
      {locationId && locationCount > 1 ? <Chips label="" value={scope} onChange={v => setScope(v as 'location' | 'all')} options={[{ value: 'location', label: t('ownerWeb.thisLocation') }, { value: 'all', label: t('ownerWeb.allLocations') }]} /> : null}
      <ResourceState resource={r} />
      {d && !d.items.length ? <p className="muted">{t('ownerWeb.noServiceYet')}</p> : null}
      <ol className="timeline">{d?.items.map(ev => <li key={ev.id}>
        <div className="timeline-head"><strong>{dateTime(ev.occurred_at, lang)}</strong>
          <span>{ev.job_id ? <Button kind="link" onClick={() => go({ section: 'job', id: ev.job_id! })}>{statusText(lang, 'jobType', ev.job_type ?? 'other')}</Button> : t('ownerWeb.adhocService')}</span>
          {ev.performed_by_name ? <span className="muted">{t('ownerWeb.byName', { name: ev.performed_by_name })}</span> : null}
          {scope === 'all' || !locationId ? <span className="muted">· {ev.location_label}</span> : null}</div>
        {ev.equipment.map(e => <div key={e.equipment_id} className="timeline-item">
          <p><Button kind="link" onClick={() => go({ section: 'equipment', id: e.equipment_id })}>{name(e)}</Button> · {statusText(lang, 'jobType', e.service_type)}{' '}
            <span className={`pill ${e.outcome === 'done' ? 'ok' : 'warn'}`}>{statusText(lang, 'outcome', e.outcome)}</span></p>
          {e.problem_note ? <p className="muted">{t('problemNote')}: {e.problem_note}</p> : null}
          {e.work_note ? <p className="muted">{t('workNote')}: {e.work_note}</p> : null}
          {e.not_done_reason ? <p className="muted">{t('notDoneReason')}: {e.not_done_reason}</p> : null}
          {e.next_due_on ? <p className="muted">{t('ownerWeb.nextDue', { date: dayText(e.next_due_on, lang) })}</p> : null}
          {e.photos.length ? <div className="timeline-photos">{e.photos.map((p, i) => p.thumbnail_url ? <a key={i} href={p.url ?? p.thumbnail_url} target="_blank" rel="noreferrer" title={statusText(lang, 'photoType', p.photo_type)}>
            <img src={p.thumbnail_url} alt={statusText(lang, 'photoType', p.photo_type)} /><span>{statusText(lang, 'photoType', p.photo_type)}</span></a> : null)}</div> : null}
        </div>)}
        {ev.note ? <p className="muted">{ev.note}</p> : null}
      </li>)}</ol>
      {d?.has_more ? <Button busy={more} onClick={() => void loadMore(d)}>{t('loadMore')}</Button> : null}
    </Panel></>;
}
