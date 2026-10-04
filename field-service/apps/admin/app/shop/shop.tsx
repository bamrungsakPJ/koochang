'use client';
import { useContext, useState } from 'react';
import { translate, type TranslationKey } from '@field-service/i18n';
import { api, type Me, type TeamMember } from './api';
import type { Go } from './OwnerApp';
import { ActionState, Button, dateTime, Empty, Field, LanguageContext, Notice, PageTitle, Panel, ResourceState, statusText, useAction, useResource, useText } from './ui';

export function Dashboard({ org, go }: { org: string; go: Go }) {
  const t = useText(), lang = useContext(LanguageContext);
  const r = useResource(async () => { const [jobs, maintenance, team, subscription, inbox] = await Promise.all([api.jobs(org), api.maintenance(org), api.team(org), api.subscription(org), api.notifications(org)]); return { jobs, maintenance, team, subscription, inbox }; }, [org]);
  const d = r.data;
  return <><PageTitle action={<Button kind="primary" onClick={() => go({ section: 'jobNew' })}>{t('createJob')}</Button>}>{t('ownerWeb.shop_overview')}</PageTitle><p className="lead muted">{t('ownerWeb.what_needs_your_attention_today')}</p><ResourceState resource={r} />
    {d ? <><div className="tiles"><Button className="tile sky" onClick={() => go({ section: 'jobs' })}><strong>{d.jobs.items.filter(j => !['completed', 'cancelled'].includes(j.status)).length}</strong><span>{t('jobs')}</span></Button>
      <Button className="tile rose" onClick={() => go({ section: 'maintenance' })}><strong>{d.maintenance.counts.overdue}</strong><span>{t('maintenanceOverdue')}</span></Button>
      <Button className="tile amber" onClick={() => go({ section: 'team' })}><strong>{d.team.members.filter(m => m.status === 'pending').length}</strong><span>{t('ownerWeb.join_requests')}</span></Button>
      <Button className="tile teal" onClick={() => go({ section: 'notifications' })}><strong>{d.inbox.unread}</strong><span>{t('notifications')}</span></Button></div>
      {!d.subscription.writable ? <Notice error>{t('SUBSCRIPTION_EXPIRED')}</Notice> : null}
      <div className="grid2"><Panel title={t('subscription')}><p>{d.subscription.plan ? lang === 'th' ? d.subscription.plan.name_th : d.subscription.plan.name_en : '—'} <span className="pill">{statusText(lang, 'sub', d.subscription.state)}</span></p><p>{dateTime(d.subscription.period_end, lang)}</p>
        {d.subscription.limits && d.subscription.usage ? <div className="usage"><p>{t('team')} {d.subscription.usage.technician_seats} / {d.subscription.limits.technician_seats}</p><p>{t('ownerWeb.photo_storage')} {(d.subscription.usage.storage_bytes / 1e9).toFixed(2)} / {(d.subscription.limits.storage_bytes / 1e9).toFixed(0)} GB</p><p>OCR {d.subscription.usage.ocr} / {d.subscription.limits.ocr_per_period}</p></div> : null}<Button onClick={() => go({ section: 'billing' })}>{t('subscription')}</Button></Panel>
      <Panel title={t('maintenance')}><p>{t('maintenanceWithin7')}: {d.maintenance.counts.within_7}</p><p>{t('maintenanceWithin30')}: {d.maintenance.counts.within_30}</p><Button onClick={() => go({ section: 'maintenance' })}>{t('maintenance')}</Button></Panel></div>
      <Panel title={t('ownerWeb.recent_jobs')}><div className="table-scroll"><table><thead><tr><th>{t('customers')}</th><th>{t('when')}</th><th>{t('assignee')}</th><th>{t('ownerWeb.status')}</th></tr></thead><tbody>{d.jobs.items.slice(0, 10).map(j => <tr key={j.id}><td><Button kind="link" onClick={() => go({ section: 'job', id: j.id })}>{j.customer_name ?? j.customer_phone ?? '—'} · {j.location_label}</Button></td><td>{dateTime(j.scheduled_start, lang)}</td><td>{j.assignee_name ?? t('unassignedOption')}</td><td>{statusText(lang, 'status', j.status)}</td></tr>)}</tbody></table></div>{!d.jobs.items.length ? <Empty /> : null}</Panel></> : null}</>;
}
export function TeamView({ org }: { org: string }) {
  const t = useText(), lang = useContext(LanguageContext), a = useAction();
  const r = useResource(async () => { const [team, link] = await Promise.all([api.team(org), api.joinLink(org)]); return { team, link }; }, [org]);
  async function act(m: TeamMember, action: string) {
    if (['remove', 'suspend'].includes(action) && !window.confirm(t('ownerWeb.change_this_member_s_access'))) return;
    await a.run(async () => { await api.changeMember(org, m.member_id, action, m.version); await r.reload(); }, t('saved'));
  }
  return <><PageTitle>{t('team')}</PageTitle><ResourceState resource={r} /><ActionState action={a} />{r.data ? <>
    <Panel title={t('joinLink')}><p>{t('joinLinkHint')}</p><div className="inline"><input aria-label={t('joinLink')} readOnly value={r.data.link.url} className="grow" /><Button onClick={() => a.run(() => navigator.clipboard.writeText(r.data!.link.url), t('ownerWeb.copied'))}>{t('ownerWeb.copy_link')}</Button></div><img className="join-qr" src={r.data.link.qr_png} alt={t('qrHint')} />
      <div className="actions"><Button busy={a.busy} onClick={() => a.run(async () => { await api.changeJoinLink(org, r.data!.link.status === 'active' ? 'close' : 'open'); await r.reload(); })}>{r.data.link.status === 'active' ? t('closeJoining') : t('openJoining')}</Button>
      <Button kind="danger" busy={a.busy} onClick={() => { if (window.confirm(t('resetConfirm'))) void a.run(async () => { await api.changeJoinLink(org, 'rotate'); await r.reload(); }); }}>{t('resetLink')}</Button></div></Panel>
    <Panel title={`${t('team')} · ${r.data.team.seats.active_technicians} / ${r.data.team.seats.seat_limit}`}><div className="table-scroll"><table><thead><tr><th>{t('yourName')}</th><th>{t('phone')}</th><th>{t('ownerWeb.status')}</th><th>{t('ownerWeb.actions')}</th></tr></thead><tbody>{r.data.team.members.map(m => <tr key={m.member_id}><td>{m.display_name} {m.role === 'owner' ? <span className="pill">{t('ownerWeb.owner')}</span> : null}</td><td>{m.phone_e164 ?? '—'}</td><td>{statusText(lang, 'member', m.status)}</td><td><div className="actions">{m.role === 'technician' ? <>
      {m.status === 'pending' ? <><Button kind="primary" busy={a.busy} onClick={() => act(m, 'approve')}>{t('approve')}</Button><Button busy={a.busy} onClick={() => act(m, 'reject')}>{t('reject')}</Button></> : null}
      {m.status === 'active' ? <Button busy={a.busy} onClick={() => act(m, 'suspend')}>{t('suspend')}</Button> : null}
      {m.status === 'suspended' ? <Button busy={a.busy} onClick={() => act(m, 'reactivate')}>{t('reactivate')}</Button> : null}
      {['active', 'suspended'].includes(m.status) ? <Button kind="danger" busy={a.busy} onClick={() => act(m, 'remove')}>{t('remove')}</Button> : null}</> : null}</div></td></tr>)}</tbody></table></div></Panel></> : null}</>;
}
export function AccountView({ me, onMe }: { me: Me; onMe: () => Promise<void> }) {
  const t = useText(), a = useAction(), [name, setName] = useState(me.user.display_name);
  return <><PageTitle>{t('account')}</PageTitle><Panel><form onSubmit={e => { e.preventDefault(); void a.run(async () => { await api.updateMe({ display_name: name.trim() }); await onMe(); }, t('saved')); }}><Field label={t('yourName')} required maxLength={80} value={name} onChange={e => setName(e.target.value)} /><Field label={t('phone')} value={me.user.phone_e164} readOnly /><Button kind="primary" busy={a.busy} type="submit">{t('save')}</Button><ActionState action={a} /></form><p className="muted">{t('ownerWeb.use_the_language_menu_at_the_top_right_your')}</p></Panel></>;
}
export function NotificationsView({ org, go }: { org: string; go: Go }) {
  const t = useText(), lang = useContext(LanguageContext), a = useAction(), r = useResource(() => api.notifications(org), [org]);
  return <><PageTitle action={<Button busy={a.busy} onClick={() => a.run(async () => { await api.markRead(org); await r.reload(); })}>{t('ownerWeb.mark_all_read')}</Button>}>{t('notifications')}</PageTitle><ResourceState resource={r} /><ActionState action={a} /><Panel>{r.data?.items.length ? <ul className="notification-list">{r.data.items.map(item => <li key={item.id} className={item.read_at ? '' : 'unread'}><Button onClick={() => a.run(async () => {
    await api.markRead(org, [item.id]);
    if (item.target_type === 'job' && item.target_id) go({ section: 'job', id: item.target_id });
    else if (item.target_type === 'invoice' && item.target_id) go({ section: 'invoice', id: item.target_id });
    else if (item.target_type === 'maintenance_cycle') go({ section: 'maintenance' });
    else if (item.target_type === 'support_ticket' || item.target_type === 'support_grant') go({ section: 'support' });
    else if (item.template_key === 'join_request') go({ section: 'team' }); else await r.reload();
  })}>{translate(lang, `notify.${item.template_key}` as TranslationKey, item.parameters)}<span className="muted">{dateTime(item.created_at, lang)}</span></Button></li>)}</ul> : <Empty />}</Panel></>;
}
