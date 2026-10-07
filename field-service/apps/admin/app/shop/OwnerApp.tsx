'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { BrandMark } from '../brand';
import { normalizeLanguage, normalizePhone, isThaiMobile, type Language } from '@field-service/core';
import { errorMessage, translate } from '@field-service/i18n';
import { notifySave } from '../toast';
import { api, ApiFailure, type Me, type Membership, type Challenge } from './api';
import { keys, storage } from './storage';
import { ActionState, Button, Field, LanguageContext, Notice, Panel, useAction, useText, uuid } from './ui';
import { Dashboard, TeamView, AccountView, NotificationsView, PasswordForm } from './shop';
import { CustomersView, CustomerView, EquipmentView } from './customers';
import { JobsView, JobView, JobForm, ServiceForm } from './jobs';
import { MaintenanceView, BillingView, InvoiceView, SupportView } from './operations';
import { Bell, CalendarClock, CircleUserRound, ClipboardList, CreditCard, LayoutDashboard, LifeBuoy, LogOut, Menu, Plus, Store, UserCog, Users, X, type LucideIcon } from 'lucide-react';

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
  const [route, setRoute] = useState<Route>({ section: 'home' }), [creating, setCreating] = useState(false), [offline, setOffline] = useState(false), [menu, setMenu] = useState(false);
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
    api.onSave = (ok, error) => notifySave(ok, error instanceof ApiFailure
      ? error.status === 0 ? translate(api.language, 'networkError') : error.message || errorMessage(api.language, error.code) : '');
    const hash = () => setRoute(readRoute()); hash(); window.addEventListener('popstate', hash);
    void (async () => {
      const lang = normalizeLanguage(await storage.get(keys.language) ?? new URLSearchParams(window.location.search).get('lang') ?? navigator.language); if (!live) return;
      setLanguage(lang); api.language = lang;
      if (await api.restore()) { try { await loadMe(); } catch { if (live) setOffline(api.signedIn); } }
      if (live) setBoot(false);
    })();
    return () => { live = false; window.removeEventListener('popstate', hash); api.onSignedOut = () => {}; api.onSave = () => {}; };
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  async function languageChange(value: Language) {
    setLanguage(value); api.language = value;
    await a.run(async () => { await storage.set(keys.language, value); if (api.signedIn) await api.updateMe({ preferred_language: value }); });
  }
  const membership = me?.memberships.find(m => m.organization_id === org && m.role === 'owner');
  const active = membership?.status === 'active', suspended = membership?.organization_status === 'suspended';
  async function signOut() { await api.signOut(); await storage.set(keys.organization, null); setMe(null); setOrg(''); go({ section: 'home' }); }
  const tr = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const languageSelect = <select className="lang" aria-label={tr('language')} value={language} onChange={e => void languageChange(e.target.value as Language)}><option value="th">ไทย</option><option value="en">English</option></select>;
  const card = (children: React.ReactNode) => <div className="signin-page"><div className="owner-language">{languageSelect}</div><main className="signin owner-card">{children}</main></div>;
  const visible: Section[] = navigation.filter(s => active && !suspended || s === 'account' || active && s === 'support');
  const current = navMeta[route.section] ? route.section : (parentSection[route.section] ?? 'home');
  const navTo = (s: Section) => { setMenu(false); go({ section: s }); };
  return <LanguageContext.Provider value={language}><div className="console owner-app">
    {boot ? card(<p role="status">{tr('loading')}</p>)
      : offline ? card(<><Notice error>{tr('networkError')}</Notice><Button kind="primary" busy={a.busy} onClick={() => a.run(loadMe)}>{tr('retry')}</Button><Button onClick={signOut}>{tr('signOut')}</Button><ActionState action={a} /></>)
      : !me ? <Auth language={languageSelect} onDone={async id => { await loadMe(id); go({ section: 'home' }); }} />
      : !me.user.password_set ? card(<><h1>{tr('setPasswordTitle')}</h1><p className="muted">{tr('setPasswordBody')}</p>
          <PasswordForm onDone={async () => { await loadMe(); }} /><Button onClick={signOut}>{tr('signOut')}</Button></>)
      : creating || !membership ? card(<><CreateShop onCreated={async id => { await loadMe(id); setCreating(false); go({ section: 'home' }); }} />
          {me.memberships.some(m => m.role === 'owner') ? <Button onClick={() => setCreating(false)}>{tr('cancel')}</Button> : null}
          {!me.memberships.some(m => m.role === 'owner') ? <p>{tr('ownerWeb.technicianAccount')}</p> : null}<Button onClick={signOut}>{tr('signOut')}</Button></>)
      : <div className={menu ? 'shell open' : 'shell'}><aside className="side" aria-label={tr('ownerWeb.navigation')}>
          <div className="brand-row"><BrandMark />
            <span className="brand-text"><strong>{tr('appName')}</strong><small>{tr('ownerWeb.workspace')}</small></span>
            <button className="icon-btn close-nav" aria-label={tr('ownerWeb.closeMenu')} onClick={() => setMenu(false)}><X size={18} /></button></div>
          <div className="shop-switch"><span className="shop-avatar" aria-hidden><Store size={16} /></span>
            <select aria-label={tr('myShops')} value={org} onChange={e => void a.run(async () => { setMenu(false); await loadMe(e.target.value); go({ section: 'home' }); })}>
              {me.memberships.filter(m => m.role === 'owner').map(m => <option key={m.organization_id} value={m.organization_id}>{m.organization_name}</option>)}</select>
            <button className="icon-btn" title={tr('createShop')} aria-label={tr('createShop')} onClick={() => { setMenu(false); setCreating(true); }}><Plus size={17} /></button></div>
          <nav>{navGroups.map(g => { const items = g.items.filter(s => visible.includes(s)); return items.length ? <div className="nav-group" key={g.key}>
            <div className="nav-label">{tr(g.key)}</div>
            {items.map(s => { const { icon: Icon, key } = navMeta[s]!; return <button key={s} className={current === s ? 'nav on' : 'nav'} aria-current={current === s ? 'page' : undefined} onClick={() => navTo(s)}>
              <Icon size={18} strokeWidth={1.9} aria-hidden /><span>{tr(key)}</span></button>; })}</div> : null; })}</nav>
          <div className="who"><span className="avatar" aria-hidden>{initials(me.user.display_name)}</span>
            <span className="who-text"><strong>{me.user.display_name}</strong><small>{me.user.phone_e164}</small></span>
            <button className="icon-btn" title={tr('signOut')} aria-label={tr('signOut')} onClick={signOut}><LogOut size={17} /></button></div>
        </aside>
        <div className="scrim" onClick={() => setMenu(false)} aria-hidden />
        <div className="main-col">
          <header className="topbar"><button className="icon-btn menu-btn" aria-label={tr('ownerWeb.openMenu')} onClick={() => setMenu(true)}><Menu size={20} /></button>
            <div className="crumbs"><span>{membership.organization_name}</span><span className="sep">/</span><strong>{tr(navMeta[current]!.key)}</strong></div>
            <div className="top-actions">{languageSelect}</div></header>
          <main className="work" key={org}><ActionState action={a} />
            {!active ? <Panel><Notice error>{tr('MEMBERSHIP_INACTIVE')}</Notice><Button busy={a.busy} onClick={() => a.run(loadMe)}>{tr('checkStatus')}</Button></Panel>
              : suspended && route.section !== 'support' && route.section !== 'account' ? <Panel><Notice error>{tr('ORGANIZATION_SUSPENDED')}</Notice><Button onClick={() => go({ section: 'support' })}>{tr('support')}</Button></Panel>
              : <Workspace key={`${org}:${route.section}:${route.id ?? ''}:${route.locationId ?? ''}`} membership={membership} me={me} route={route} go={go} onMe={() => loadMe(org)} />}
          </main></div></div>}
  </div></LanguageContext.Provider>;
}
const initials = (name: string) => name.replace(/^\+\d+/, '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '•';
type NavKey = Parameters<typeof translate>[1];
const navMeta: Partial<Record<Section, { icon: LucideIcon; key: NavKey }>> = {
  home: { icon: LayoutDashboard, key: 'home' }, jobs: { icon: ClipboardList, key: 'jobs' }, customers: { icon: Users, key: 'customers' },
  maintenance: { icon: CalendarClock, key: 'maintenance' }, team: { icon: UserCog, key: 'team' }, billing: { icon: CreditCard, key: 'subscription' },
  notifications: { icon: Bell, key: 'notifications' }, support: { icon: LifeBuoy, key: 'support' }, account: { icon: CircleUserRound, key: 'account' },
};
/** Detail pages highlight the list they belong to. */
const parentSection: Partial<Record<Section, Section>> = { customer: 'customers', equipment: 'customers', job: 'jobs', jobNew: 'jobs', service: 'jobs', invoice: 'billing' };
const navGroups: { key: NavKey; items: Section[] }[] = [
  { key: 'ownerWeb.groupWork', items: ['home', 'jobs', 'customers', 'maintenance'] },
  { key: 'ownerWeb.groupShop', items: ['team', 'billing', 'notifications'] },
  { key: 'ownerWeb.groupHelp', items: ['support', 'account'] },
];
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
/** Sign-in is phone + password. An SMS code is sent only to create an account (create a shop)
 * and when the password is forgotten; both then set a password. */
type AuthMode = 'signin' | 'register' | 'reset';
function Auth({ onDone, language }: { onDone: (org?: string) => Promise<void>; language: React.ReactNode }) {
  const t = useText(), a = useAction();
  const [mode, setMode] = useState<AuthMode>('signin'), [name, setName] = useState(''), [phone, setPhone] = useState(''), [password, setPassword] = useState(''), [code, setCode] = useState(''), [challenge, setChallenge] = useState<Challenge | null>(null), [wait, setWait] = useState(0), [needPassword, setNeedPassword] = useState(false);
  const request = useRef<string | null>(null);
  // Landing-page trial buttons link to /shop?signup=1 so visitors land on create-shop, not sign-in.
  useEffect(() => { if (new URLSearchParams(window.location.search).has('signup')) setMode('register'); }, []);
  useEffect(() => { if (wait > 0) { const timer = setTimeout(() => setWait(x => x - 1), 1000); return () => clearTimeout(timer); } }, [wait]);
  const checkedPhone = () => {
    const normalized = normalizePhone(phone); if (!normalized || normalized.startsWith('+66') && !isThaiMobile(normalized)) throw new ApiFailure(400, 'VALIDATION_ERROR', '', { phone: 'field.phone' });
    setPhone(normalized); return normalized;
  };
  const requestOtp = () => a.run(async () => { const next = await api.requestOtp(checkedPhone()); setChallenge(next); setWait(next.resend_after); setCode(''); });
  const switchMode = (next: AuthMode) => { setMode(next); setChallenge(null); setPassword(''); request.current = null; a.setError(null); };
  const finish = async () => {
    if (mode === 'register') { const result = await api.createOrganization(name.trim(), request.current ?? (request.current = uuid())); await onDone(result.organization.id); } else await onDone();
  };
  const heading = mode === 'reset' ? t('resetPasswordTitle') : mode === 'register' ? t('createShop') : t('ownerWeb.your_shop_organized');
  return <div className="signin-page owner-auth"><div className="owner-language">{language}</div><main className="signin owner-card">
    <div className="signin-brand"><BrandMark large /><span><strong className="brand-name">{t('appName')}</strong><small>{t('ownerWeb.workspace')}</small></span></div>
    <h1>{needPassword ? t('setPasswordTitle') : heading}</h1><p className="muted">{needPassword ? t('setPasswordBody') : mode === 'reset' ? t('resetPasswordHint') : t('ownerWeb.jobs_people_and_customers_in_one_workspace')}</p>
    {needPassword ? <PasswordForm onDone={finish} />
    : mode === 'signin' ? <form onSubmit={e => { e.preventDefault(); void a.run(async () => { await api.passwordLogin(checkedPhone(), password); await onDone(); }); }}>
        <Field label={t('phone')} type="tel" required value={phone} onChange={e => setPhone(e.target.value)} autoComplete="username" />
        <Field label={t('password')} type="password" required maxLength={200} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
        <Button kind="primary" type="submit" busy={a.busy}>{t('signIn')}</Button><Button disabled={a.busy} onClick={() => switchMode('reset')}>{t('forgotPassword')}</Button></form>
    : <form onSubmit={e => { e.preventDefault(); if (!challenge) void requestOtp(); else void a.run(async () => {
        if (!api.signedIn) { const verified = await api.verifyOtp(challenge.challenge_id, code); if (mode === 'reset' || !verified.password_set) { setNeedPassword(true); return; } }
        await finish();
      }); }}>
      {!challenge ? <>{mode === 'register' ? <Field label={t('shopName')} required maxLength={120} value={name} onChange={e => setName(e.target.value)} /> : null}<Field label={t('phone')} type="tel" required value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" />
      <Button kind="primary" type="submit" busy={a.busy}>{t('next')}</Button></>
      : <><Notice>{t('otpSentTo', { phone })}</Notice><Field label={t('otpCode')} required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
        {challenge.delivery === 'development' ? <Notice>{t('devOtpNotice')}</Notice> : null}<Button kind="primary" type="submit" busy={a.busy}>{t('confirm')}</Button><Button disabled={wait > 0 || a.busy} onClick={requestOtp}>{wait ? t('resendIn', { seconds: wait }) : t('resend')}</Button><Button disabled={a.busy} onClick={() => { setChallenge(null); request.current = null; }}>{t('changePhone')}</Button></>}
    </form>}<ActionState action={a} />
    {!challenge && !needPassword ? <Button onClick={() => switchMode(mode === 'signin' ? 'register' : 'signin')}>{mode === 'signin' ? t('createShop') : t('signIn')}</Button> : null}<a className="platform-link" href="/console">{t('ownerWeb.platform_staff_sign_in')}</a></main></div>;
}
function CreateShop({ onCreated }: { onCreated: (id: string) => Promise<void> }) {
  const t = useText(), a = useAction(), [name, setName] = useState(''), key = useRef<string | null>(null);
  return <form onSubmit={e => { e.preventDefault(); void a.run(async () => { const result = await api.createOrganization(name.trim(), key.current ?? (key.current = uuid())); await onCreated(result.organization.id); }); }}><h1>{t('createShop')}</h1><Field label={t('shopName')} required maxLength={120} value={name} onChange={e => setName(e.target.value)} /><Button type="submit" kind="primary" busy={a.busy}>{t('createShop')}</Button><ActionState action={a} /></form>;
}
