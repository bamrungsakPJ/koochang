'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { normalizeLanguage, normalizePhone, isThaiMobile, type Language } from '@field-service/core';
import { translate } from '@field-service/i18n';
import { api, ApiFailure, type Me, type Membership, type Challenge } from './api';
import { keys, storage } from './storage';
import { ActionState, Button, Field, LanguageContext, Notice, Panel, useAction, useText, uuid } from './ui';
import { Dashboard, TeamView, AccountView, NotificationsView } from './shop';
import { CustomersView, CustomerView, EquipmentView } from './customers';
import { JobsView, JobView, JobForm, ServiceForm } from './jobs';
import { MaintenanceView, BillingView, InvoiceView, SupportView } from './operations';

export type Section = 'home' | 'customers' | 'customer' | 'equipment' | 'jobs' | 'job' | 'jobNew' | 'service' | 'maintenance' | 'team' | 'billing' | 'invoice' | 'support' | 'notifications' | 'account';
export interface Route { section: Section; id?: string; customerId?: string; locationId?: string }
export type Go = (route: Route) => void;
const sections: Section[] = ['home', 'customers', 'customer', 'equipment', 'jobs', 'job', 'jobNew', 'service', 'maintenance', 'team', 'billing', 'invoice', 'support', 'notifications', 'account'];
const navigation = ['home', 'jobs', 'customers', 'maintenance', 'team', 'billing', 'notifications', 'support', 'account'] as const;
function readRoute(): Route {
  let query = window.location.search || window.location.hash.slice(1);
  if (!query) { try { query = sessionStorage.getItem(keys.route) ?? ''; } catch { /* default home */ } }
  const p = new URLSearchParams(query);
  const section = p.get('section') as Section;
  return { section: sections.includes(section) ? section : 'home', id: p.get('id') ?? undefined, customerId: p.get('customerId') ?? undefined, locationId: p.get('locationId') ?? undefined };
}

export function OwnerApp() {
  const router = useRouter();
  const [language, setLanguage] = useState<Language>('th'), [me, setMe] = useState<Me | null>(null), [org, setOrg] = useState(''), [boot, setBoot] = useState(true);
  const [route, setRoute] = useState<Route>({ section: 'home' }), [creating, setCreating] = useState(false), [offline, setOffline] = useState(false);
  const a = useAction();
  const go: Go = r => { const q = new URLSearchParams(Object.entries(r).filter(([, v]) => v) as [string, string][]); void storage.set(keys.route, q.toString()).catch(() => {}); router.push(`/shop?${q.toString()}`); setRoute(r); };
  async function loadMe(prefer?: string) {
    const next = await api.me(); setMe(next); setOffline(false);
    const saved = prefer ?? new URLSearchParams(window.location.search).get('organization_id') ?? await storage.get(keys.organization);
    const selected = next.memberships.find(m => m.organization_id === saved && m.role === 'owner') ?? next.memberships.find(m => m.role === 'owner' && m.status === 'active') ?? next.memberships.find(m => m.role === 'owner');
    setOrg(selected?.organization_id ?? ''); await storage.set(keys.organization, selected?.organization_id ?? null);
    setLanguage(next.user.preferred_language); api.language = next.user.preferred_language;
  }
  useEffect(() => {
    let live = true;
    api.onSignedOut = () => { setMe(null); setOrg(''); setOffline(false); };
    const hash = () => setRoute(readRoute()); hash(); window.addEventListener('popstate', hash);
    void (async () => {
      const lang = normalizeLanguage(await storage.get(keys.language) ?? navigator.language); if (!live) return;
      setLanguage(lang); api.language = lang;
      if (await api.restore()) { try { await loadMe(); } catch { if (live) setOffline(api.signedIn); } }
      if (live) setBoot(false);
    })();
    return () => { live = false; window.removeEventListener('popstate', hash); api.onSignedOut = () => {}; };
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  async function languageChange(value: Language) {
    setLanguage(value); api.language = value;
    await a.run(async () => { await storage.set(keys.language, value); if (api.signedIn) await api.updateMe({ preferred_language: value }); });
  }
  const membership = me?.memberships.find(m => m.organization_id === org && m.role === 'owner');
  const active = membership?.status === 'active', suspended = membership?.organization_status === 'suspended';
  async function signOut() { await api.signOut(); await storage.set(keys.organization, null); setMe(null); setOrg(''); go({ section: 'home' }); }
  return <LanguageContext.Provider value={language}><div className="console owner-app">
    <div className="owner-language"><label>{translate(language, 'language')} <select value={language} onChange={e => void languageChange(e.target.value as Language)}><option value="th">ไทย</option><option value="en">English</option></select></label></div>
    {boot ? <main className="signin"><p role="status">{translate(language, 'loading')}</p></main>
      : offline ? <main className="signin"><Notice error>{translate(language, 'networkError')}</Notice><Button kind="primary" busy={a.busy} onClick={() => a.run(loadMe)}>{translate(language, 'retry')}</Button><Button onClick={signOut}>{translate(language, 'signOut')}</Button><ActionState action={a} /></main>
      : !me ? <Auth onDone={async id => { await loadMe(id); go({ section: 'home' }); }} />
      : creating || !membership ? <main className="signin"><CreateShop onCreated={async id => { await loadMe(id); setCreating(false); go({ section: 'home' }); }} />
          {me.memberships.some(m => m.role === 'owner') ? <Button onClick={() => setCreating(false)}>{translate(language, 'cancel')}</Button> : null}
          {!me.memberships.some(m => m.role === 'owner') ? <p>{translate(language, 'ownerWeb.technicianAccount')}</p> : null}<Button onClick={signOut}>{translate(language, 'signOut')}</Button></main>
      : <div className="shell"><aside className="side"><a href="/shop" className="logo">Field Service<span>{translate(language, 'ownerWeb.workspace')}</span></a>
        <label className="shop-switch">{translate(language, 'myShops')}<select aria-label={translate(language, 'myShops')} value={org} onChange={e => void a.run(async () => { await loadMe(e.target.value); go({ section: 'home' }); })}>
          {me.memberships.filter(m => m.role === 'owner').map(m => <option key={m.organization_id} value={m.organization_id}>{m.organization_name}</option>)}</select></label>
        <nav aria-label={translate(language, 'ownerWeb.navigation')}>{navigation.filter(s => active && !suspended || s === 'account' || active && s === 'support').map(s => <Button key={s} className={`nav ${route.section === s ? 'on' : ''}`} onClick={() => go({ section: s })}>{translate(language, s === 'home' ? 'home' : s === 'billing' ? 'subscription' : s)}</Button>)}</nav>
        <div className="who"><strong>{me.user.display_name}</strong><span>{me.user.phone_e164}</span><Button onClick={() => setCreating(true)}>{translate(language, 'createShop')}</Button><Button onClick={signOut}>{translate(language, 'signOut')}</Button></div></aside>
        <main className="work" key={org}><ActionState action={a} />
          {!active ? <Panel><Notice error>{translate(language, 'MEMBERSHIP_INACTIVE')}</Notice><Button busy={a.busy} onClick={() => a.run(loadMe)}>{translate(language, 'checkStatus')}</Button></Panel>
            : suspended && route.section !== 'support' && route.section !== 'account' ? <Panel><Notice error>{translate(language, 'ORGANIZATION_SUSPENDED')}</Notice><Button onClick={() => go({ section: 'support' })}>{translate(language, 'support')}</Button></Panel>
            : <Workspace key={`${org}:${route.section}:${route.id ?? ''}:${route.locationId ?? ''}`} membership={membership} me={me} route={route} go={go} onMe={() => loadMe(org)} />}
        </main></div>}
  </div></LanguageContext.Provider>;
}
function Workspace({ membership: m, me, route: r, go, onMe }: { membership: Membership; me: Me; route: Route; go: Go; onMe: () => Promise<void> }) {
  switch (r.section) {
    case 'customers': return <CustomersView org={m.organization_id} go={go} />;
    case 'customer': return r.id ? <CustomerView org={m.organization_id} id={r.id} go={go} /> : <CustomersView org={m.organization_id} go={go} />;
    case 'equipment': return r.id ? <EquipmentView org={m.organization_id} id={r.id} go={go} /> : <CustomersView org={m.organization_id} go={go} />;
    case 'jobs': return <JobsView org={m.organization_id} go={go} />;
    case 'jobNew': return <JobForm org={m.organization_id} customerId={r.customerId} locationId={r.locationId} memberId={m.member_id} go={go} />;
    case 'job': return r.id ? <JobView membership={m} id={r.id} go={go} /> : <JobsView org={m.organization_id} go={go} />;
    case 'service': return <ServiceForm membership={m} jobId={r.id} customerId={r.customerId} locationId={r.locationId} go={go} />;
    case 'maintenance': return <MaintenanceView org={m.organization_id} go={go} />;
    case 'team': return <TeamView org={m.organization_id} />;
    case 'billing': return <BillingView org={m.organization_id} go={go} />;
    case 'invoice': return r.id ? <InvoiceView org={m.organization_id} id={r.id} go={go} /> : <BillingView org={m.organization_id} go={go} />;
    case 'support': return <SupportView org={m.organization_id} />;
    case 'notifications': return <NotificationsView org={m.organization_id} go={go} />;
    case 'account': return <AccountView me={me} onMe={onMe} />;
    default: return <Dashboard org={m.organization_id} go={go} />;
  }
}
function Auth({ onDone }: { onDone: (org?: string) => Promise<void> }) {
  const t = useText(), a = useAction();
  const [register, setRegister] = useState(false), [name, setName] = useState(''), [phone, setPhone] = useState(''), [code, setCode] = useState(''), [challenge, setChallenge] = useState<Challenge | null>(null), [wait, setWait] = useState(0);
  const request = useRef<string | null>(null);
  useEffect(() => { if (wait > 0) { const timer = setTimeout(() => setWait(x => x - 1), 1000); return () => clearTimeout(timer); } }, [wait]);
  const requestOtp = () => a.run(async () => {
    const normalized = normalizePhone(phone); if (!normalized || normalized.startsWith('+66') && !isThaiMobile(normalized)) throw new ApiFailure(400, 'VALIDATION_ERROR', '', { phone: 'field.phone' });
    setPhone(normalized); const next = await api.requestOtp(normalized); setChallenge(next); setWait(next.resend_after); setCode('');
  });
  return <main className="signin owner-signin"><a className="logo" href="/shop">Field Service</a><h1>{t('ownerWeb.your_shop_organized')}</h1><p className="muted">{t('ownerWeb.jobs_people_and_customers_in_one_workspace')}</p>
    <form onSubmit={e => { e.preventDefault(); if (!challenge) void requestOtp(); else void a.run(async () => {
      if (!api.signedIn) await api.verifyOtp(challenge.challenge_id, code);
      if (register) { const result = await api.createOrganization(name.trim(), request.current ?? (request.current = uuid())); await onDone(result.organization.id); } else await onDone();
    }); }}>
      {!challenge ? <>{register ? <Field label={t('shopName')} required maxLength={120} value={name} onChange={e => setName(e.target.value)} /> : null}<Field label={t('phone')} type="tel" required value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" />
      <Button kind="primary" type="submit" busy={a.busy}>{register ? t('createShop') : t('signIn')}</Button></>
      : <><Notice>{t('otpSentTo', { phone })}</Notice><Field label={t('otpCode')} required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
        {challenge.delivery === 'development' ? <Notice>{t('devOtpNotice')}</Notice> : null}<Button kind="primary" type="submit" busy={a.busy}>{t('confirm')}</Button><Button disabled={wait > 0 || a.busy} onClick={requestOtp}>{wait ? t('resendIn', { seconds: wait }) : t('resend')}</Button><Button disabled={a.busy} onClick={() => { setChallenge(null); request.current = null; }}>{t('changePhone')}</Button></>}
    </form><ActionState action={a} />{!challenge ? <Button onClick={() => { setRegister(!register); request.current = null; }}>{register ? t('signIn') : t('createShop')}</Button> : null}<a className="platform-link" href="/console">{t('ownerWeb.platform_staff_sign_in')}</a></main>;
}
function CreateShop({ onCreated }: { onCreated: (id: string) => Promise<void> }) {
  const t = useText(), a = useAction(), [name, setName] = useState(''), key = useRef<string | null>(null);
  return <form onSubmit={e => { e.preventDefault(); void a.run(async () => { const result = await api.createOrganization(name.trim(), key.current ?? (key.current = uuid())); await onCreated(result.organization.id); }); }}><h1>{t('createShop')}</h1><Field label={t('shopName')} required maxLength={120} value={name} onChange={e => setName(e.target.value)} /><Button type="submit" kind="primary" busy={a.busy}>{t('createShop')}</Button><ActionState action={a} /></form>;
}
