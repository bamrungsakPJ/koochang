'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Language } from '@field-service/core';
import type { AdminKey } from '@field-service/i18n';
import { call, ConsoleError, LanguageContext, normalizeLanguage, session, setApiLanguage, setOnSignedOut, StepUpContext, useText, type Me } from './api';
import { InvoiceView, PaymentsView, ReconcileView, RefundsView } from './payments';
import { AccessView, AuditView, DataRequestsView, OverviewView, ShopsView, ShopView, SystemView, TicketsView, TicketView } from './admin';
import { PaymentSettingsView } from './payment-settings';
import { AccountSettingsView, PlatformSettingsView } from './settings';
import { ApprovalsView, CatalogView, Enrollment, PolicyView, StaffView } from './management';
import { CommunicationsView, OperationsView } from './operations';
import { PrivacyView } from './privacy';
import { Activity, CircleUserRound, ClipboardCheck, CreditCard, DatabaseZap, FileSpreadsheet, KeyRound, LayoutDashboard, LifeBuoy, LogOut, Megaphone, Menu,
  RotateCcw, Scale, ScrollText, Settings, ShieldCheck, Store, Tags, Users, Wallet, Wrench, X, type LucideIcon } from 'lucide-react';

type View = { name: 'overview' } | { name: 'payments' } | { name: 'invoice'; id: string } | { name: 'refunds' } | { name: 'reconcile' } | { name: 'shops' } | { name: 'shop'; id: string }
  | { name: 'support' } | { name: 'ticket'; id: string } | { name: 'access' } | { name: 'audit' } | { name: 'system' } | { name: 'data' } | {name:'paymentSettings'} | {name:'settings'} | {name:'account'} | {name:'staff'|'catalog'|'approvals'|'policy'|'communications'|'operations'};
type NavName = 'overview' | 'payments' | 'refunds' | 'reconcile' | 'shops' | 'support' | 'access' | 'audit' | 'system' | 'data' | 'paymentSettings' | 'settings' | 'account' | 'staff'|'catalog'|'approvals'|'policy'|'communications'|'operations';
type Group = 'navGroupMain' | 'navGroupFinance' | 'navGroupSupport' | 'navGroupTeam' | 'navGroupSystem' | 'navGroupSettings';
const nav: { name: NavName; key: AdminKey; group: Group; icon: LucideIcon; permission?: string }[] = [
  { name: 'overview', key: 'navOverview', group: 'navGroupMain', icon: LayoutDashboard, permission: 'shops.read' },
  { name: 'shops', key: 'navShops', group: 'navGroupMain', icon: Store, permission: 'shops.read' },
  { name: 'payments', key: 'navPayments', group: 'navGroupFinance', icon: CreditCard, permission: 'billing.read' },
  { name: 'refunds', key: 'navRefunds', group: 'navGroupFinance', icon: RotateCcw, permission: 'billing.read' },
  { name: 'reconcile', key: 'navReconcile', group: 'navGroupFinance', icon: FileSpreadsheet, permission: 'billing.read' },
  { name: 'catalog', key: 'navCatalog', group: 'navGroupFinance', icon: Tags, permission: 'plans.manage' },
  { name: 'support', key: 'navSupport', group: 'navGroupSupport', icon: LifeBuoy, permission: 'support.read' },
  { name: 'access', key: 'navAccess', group: 'navGroupSupport', icon: KeyRound, permission: 'access.approve' },
  { name: 'data', key: 'navData', group: 'navGroupSupport', icon: DatabaseZap, permission: 'data.manage' },
  { name: 'staff', key: 'navStaff', group: 'navGroupTeam', icon: Users, permission: 'accounts.manage' },
  { name: 'approvals', key: 'navApprovals', group: 'navGroupTeam', icon: ClipboardCheck, permission: 'approvals.read' },
  { name: 'system', key: 'navSystem', group: 'navGroupSystem', icon: Activity, permission: 'system.read' },
  { name: 'operations', key: 'navOperations', group: 'navGroupSystem', icon: Wrench, permission: 'system.read' },
  { name: 'communications', key: 'navCommunications', group: 'navGroupSystem', icon: Megaphone, permission: 'communications.manage' },
  { name: 'audit', key: 'navAudit', group: 'navGroupSystem', icon: ScrollText, permission: 'audit.read' },
  { name: 'paymentSettings', key: 'paymentSettings', group: 'navGroupSettings', icon: Wallet, permission: 'payments.manage' },
  { name: 'settings', key: 'platformSettings', group: 'navGroupSettings', icon: Settings, permission: 'settings.manage' },
  { name: 'policy', key: 'navPolicy', group: 'navGroupSettings', icon: Scale, permission: 'settings.manage' },
  { name: 'account', key: 'accountSettings', group: 'navGroupSettings', icon: CircleUserRound },
];
const parent: Partial<Record<View['name'], NavName>> = { invoice: 'payments', shop: 'shops', ticket: 'support' };

export function Console() {
  const [language, setLanguage] = useState<Language>('th');
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [invite,setInvite]=useState<string|null>(null);
  const [view, setView] = useState<View | null>(null);
  const stepUpResolve = useRef<((ok: boolean) => void) | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);

  useEffect(() => {
    const token=new URLSearchParams(location.hash.slice(1)).get('invite');
    if(token){setInvite(token);history.replaceState(null,'',location.pathname+location.search);}
    const saved = (() => { try { return localStorage.getItem('console.language'); } catch { return null; } })();
    const lang = normalizeLanguage(saved ?? navigator.language);
    setLanguage(lang); setApiLanguage(lang);
    setOnSignedOut(() => { setMe(null); setView(null); });
    if (session.get()) call<Me>('GET', '/platform/auth/me').then(setMe, () => setMe(null)).finally(() => setReady(true));
    else setReady(true);
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  function changeLanguage(value: Language) { setLanguage(value); setApiLanguage(value); try { localStorage.setItem('console.language', value); } catch { /* ignore */ } }

  const askStepUp = useCallback(() => new Promise<boolean>(resolve => { stepUpResolve.current = resolve; setStepUpOpen(true); }), []);
  function closeStepUp(ok: boolean) { setStepUpOpen(false); stepUpResolve.current?.(ok); stepUpResolve.current = null; }

  let content: ReactNode = null;
  if (!ready) content = null;
  else if(invite)content=<Enrollment token={invite} onDone={()=>setInvite(null)}/>;
  else if (!me) content = <SignIn onSignedIn={setMe} />;
  else {
    const allowed = nav.filter(n => !n.permission || me.permissions.includes(n.permission));
    const current: View = view ?? (allowed[0] ? { name: allowed[0].name } as View : { name: 'overview' });
    const section = parent[current.name] ?? current.name;
    const go = (name: string) => setView({ name } as View);
    const body = !allowed.some(n => n.name === section) ? <NoPermission />
      : current.name === 'invoice' ? <InvoiceView id={current.id} me={me} onBack={() => go('payments')} />
      : current.name === 'shop' ? <ShopView id={current.id} me={me} onBack={() => go('shops')} />
      : current.name === 'ticket' ? <TicketView id={current.id} me={me} onBack={() => go('support')} />
      : current.name === 'overview' ? <OverviewView onNavigate={name => { if (allowed.some(n => n.name === name)) go(name); }} />
      : current.name === 'payments' ? <PaymentsView onOpen={id => setView({ name: 'invoice', id })} />
      : current.name === 'refunds' ? <RefundsView me={me} onOpen={id => setView({ name: 'invoice', id })} />
      : current.name === 'reconcile' ? <ReconcileView />
      : current.name === 'shops' ? <ShopsView onOpen={id => setView({ name: 'shop', id })} />
      : current.name === 'support' ? <TicketsView onOpen={id => setView({ name: 'ticket', id })} />
      : current.name === 'access' ? <AccessView me={me} />
      : current.name === 'audit' ? <AuditView />
      : current.name === 'system' ? <SystemView />
      : current.name === 'staff' ? <StaffView me={me}/>
      : current.name === 'catalog' ? <CatalogView me={me}/>
      : current.name === 'approvals' ? <ApprovalsView me={me}/>
      : current.name === 'policy' ? <PolicyView me={me}/>
      : current.name === 'communications' ? <CommunicationsView/>
      : current.name === 'operations' ? <OperationsView me={me}/>
      : current.name === 'paymentSettings' ? <PaymentSettingsView />
      : current.name === 'settings' ? <PlatformSettingsView />
      : current.name === 'account' ? <AccountSettingsView onUpdated={value=>{setMe(value);changeLanguage(normalizeLanguage(value.preferred_language));}} />
      : <PrivacyView me={me}/>;
    content = <Shell me={me} view={section} items={allowed} onNavigate={go}
      onSignOut={async () => { try { await call('POST', '/platform/auth/logout'); } catch { /* ignore */ } session.set(null); setMe(null); }}>{body}</Shell>;
  }

  return <LanguageContext.Provider value={language}>
    <StepUpContext.Provider value={askStepUp}>
      <div className="console">
        {me && !invite ? null : <LanguageSelect value={language} onChange={changeLanguage} floating />}
        {me && !invite && content ? <LanguageBridge value={language} onChange={changeLanguage}>{content}</LanguageBridge> : content}
        {stepUpOpen ? <StepUpDialog onDone={closeStepUp} /> : null}
      </div>
    </StepUpContext.Provider>
  </LanguageContext.Provider>;
}

function LanguageSelect({ value, onChange, floating }: { value: Language; onChange: (v: Language) => void; floating?: boolean }) {
  return <select className={floating ? 'lang floating' : 'lang'} aria-label="Language" value={value} onChange={e => onChange(normalizeLanguage(e.target.value))}>
    <option value="th">ไทย</option><option value="en">English</option>
  </select>;
}

/** Hands the language control to the signed-in shell's top bar. */
const LanguageControl = createContext<ReactNode>(null);
function LanguageBridge({ value, onChange, children }: { value: Language; onChange: (v: Language) => void; children: ReactNode }) {
  return <LanguageControl.Provider value={<LanguageSelect value={value} onChange={onChange} />}>{children}</LanguageControl.Provider>;
}

const rolePriority = ['super_admin', 'platform_admin', 'billing_approver', 'billing_operator', 'operations', 'support_agent', 'auditor'];
const mainRole = (roles: string[]) => [...roles].sort((a, b) => (rolePriority.indexOf(a) + 1 || 99) - (rolePriority.indexOf(b) + 1 || 99))[0] ?? '';
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';

function Shell({ me, view, items, onNavigate, onSignOut, children }: { me: Me; view: string; items: typeof nav; onNavigate: (name: NavName) => void; onSignOut: () => void; children: ReactNode }) {
  const t = useText();
  const language = useContext(LanguageControl);
  const [open, setOpen] = useState(false);
  const current = items.find(n => n.name === view);
  const groups = items.reduce<{ group: Group; items: typeof nav }[]>((list, n) => {
    const last = list.at(-1);
    if (last?.group === n.group) last.items.push(n); else list.push({ group: n.group, items: [n] });
    return list;
  }, []);
  const go = (name: NavName) => { setOpen(false); onNavigate(name); };
  return <div className={open ? 'shell open' : 'shell'}>
    <aside className="side" aria-label={t('consoleTitle')}>
      <div className="brand-row">
        <span className="brand-mark" aria-hidden><ShieldCheck size={18} strokeWidth={2.2} /></span>
        <span className="brand-text"><strong>{t('consoleTitle')}</strong><small>Field Service</small></span>
        <button className="icon-btn close-nav" aria-label={t('cancel')} onClick={() => setOpen(false)}><X size={18} /></button>
      </div>
      <nav>{groups.map(g => <div className="nav-group" key={g.group}>
        <div className="nav-label">{t(g.group)}</div>
        {g.items.map(n => { const Icon = n.icon; return <button key={n.name} className={view === n.name ? 'nav on' : 'nav'} aria-current={view === n.name ? 'page' : undefined} onClick={() => go(n.name)}>
          <Icon size={18} strokeWidth={1.9} aria-hidden /><span>{t(n.key)}</span></button>; })}
      </div>)}</nav>
      <div className="who">
        <span className="avatar" aria-hidden>{initials(me.display_name)}</span>
        <span className="who-text"><strong>{me.display_name}</strong><small>{me.email}</small></span>
        <button className="icon-btn" title={t('signOut')} aria-label={t('signOut')} onClick={onSignOut}><LogOut size={17} /></button>
      </div>
    </aside>
    <div className="scrim" onClick={() => setOpen(false)} aria-hidden />
    <div className="main-col">
      <header className="topbar">
        <button className="icon-btn menu-btn" aria-label={t('openMenu')} onClick={() => setOpen(true)}><Menu size={20} /></button>
        <div className="crumbs">{current ? <><span>{t(current.group)}</span><span className="sep">/</span><strong>{t(current.key)}</strong></> : null}</div>
        <div className="top-actions">{language}<span className="role-chip" title={me.roles.join(', ')}>{mainRole(me.roles)}{me.roles.length > 1 ? ` +${me.roles.length - 1}` : ''}</span></div>
      </header>
      <main className="work">{children}</main>
    </div>
  </div>;
}

function NoPermission() { const t = useText(); return <p className="notice">{t('noPermission')}</p>; }

function SignIn({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const t = useText();
  const [step, setStep] = useState<'password' | 'mfa'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      if (step === 'password') {
        const r = await call<{ mfa_token: string }>('POST', '/platform/auth/login', { email, password }, false);
        setMfaToken(r.mfa_token); setPassword(''); setStep('mfa');
      } else {
        const r = await call<{ access_token: string }>('POST', '/platform/auth/mfa', { mfa_token: mfaToken, code }, false);
        session.set(r.access_token);
        onSignedIn(await call<Me>('GET', '/platform/auth/me'));
      }
    } catch (e) {
      setError(e instanceof ConsoleError ? e.message : String(e));
      if (step === 'mfa') { setStep('password'); setCode(''); }
    } finally { setBusy(false); }
  }
  return <div className="signin-page"><form className="signin" onSubmit={submit}>
    <div className="signin-brand"><span className="brand-mark lg" aria-hidden><ShieldCheck size={22} strokeWidth={2.2} /></span>
      <span><h1>{t('consoleTitle')}</h1><small>Field Service</small></span></div>
    {step === 'password' ? <>
      <h2>{t('signIn')}</h2>
      <label>{t('email')}<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>{t('password')}<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
    </> : <>
      <h2>{t('mfaTitle')}</h2><p className="muted">{t('mfaHint')}</p>
      <label>{t('code')}<input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></label>
    </>}
    {error ? <p className="error" role="alert">{error}</p> : null}
    <button className="primary" disabled={busy}>{step === 'password' ? t('next') : t('confirm')}</button>
  </form></div>;
}

function StepUpDialog({ onDone }: { onDone: (ok: boolean) => void }) {
  const t = useText();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { await call('POST', '/platform/auth/step-up', { code }); onDone(true); }
    catch (e) { setError(e instanceof ConsoleError ? e.message : String(e)); setCode(''); }
    finally { setBusy(false); }
  }
  return <div className="backdrop" role="dialog" aria-modal="true" aria-labelledby="stepup-title">
    <form className="dialog" onSubmit={submit}>
      <span className="dialog-icon" aria-hidden><KeyRound size={20} /></span>
      <h2 id="stepup-title">{t('stepUpTitle')}</h2><p className="muted">{t('stepUpHint')}</p>
      <label>{t('code')}<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></label>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="row"><button type="button" className="ghost" onClick={() => onDone(false)}>{t('cancel')}</button><button className="primary" disabled={busy}>{t('confirm')}</button></div>
    </form>
  </div>;
}
