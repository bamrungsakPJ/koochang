'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Language } from '@field-service/core';
import { call, ConsoleError, LanguageContext, normalizeLanguage, session, setApiLanguage, setOnSignedOut, StepUpContext, useText, type Me } from './api';
import { InvoiceView, PaymentsView, ReconcileView, RefundsView } from './payments';

type View = { name: 'payments' } | { name: 'invoice'; id: string } | { name: 'refunds' } | { name: 'reconcile' };
const nav: { name: View['name']; key: 'navPayments' | 'navRefunds' | 'navReconcile'; permission: string }[] = [
  { name: 'payments', key: 'navPayments', permission: 'billing.read' },
  { name: 'refunds', key: 'navRefunds', permission: 'billing.read' },
  { name: 'reconcile', key: 'navReconcile', permission: 'billing.read' },
];

export function Console() {
  const [language, setLanguage] = useState<Language>('th');
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>({ name: 'payments' });
  const stepUpResolve = useRef<((ok: boolean) => void) | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);

  useEffect(() => {
    const saved = (() => { try { return localStorage.getItem('console.language'); } catch { return null; } })();
    const lang = normalizeLanguage(saved ?? navigator.language);
    setLanguage(lang); setApiLanguage(lang);
    setOnSignedOut(() => setMe(null));
    if (session.get()) call<Me>('GET', '/platform/auth/me').then(setMe, () => setMe(null)).finally(() => setReady(true));
    else setReady(true);
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  function changeLanguage(value: Language) { setLanguage(value); setApiLanguage(value); try { localStorage.setItem('console.language', value); } catch { /* ignore */ } }

  const askStepUp = useCallback(() => new Promise<boolean>(resolve => { stepUpResolve.current = resolve; setStepUpOpen(true); }), []);
  function closeStepUp(ok: boolean) { setStepUpOpen(false); stepUpResolve.current?.(ok); stepUpResolve.current = null; }

  let content: ReactNode = null;
  if (!ready) content = null;
  else if (!me) content = <SignIn onSignedIn={setMe} />;
  else {
    const allowed = nav.filter(n => me.permissions.includes(n.permission));
    const body = view.name === 'invoice' ? <InvoiceView id={view.id} me={me} onBack={() => setView({ name: 'payments' })} />
      : !allowed.some(n => n.name === view.name) ? <NoPermission />
      : view.name === 'payments' ? <PaymentsView onOpen={id => setView({ name: 'invoice', id })} />
      : view.name === 'refunds' ? <RefundsView me={me} onOpen={id => setView({ name: 'invoice', id })} />
      : <ReconcileView />;
    content = <Shell me={me} view={view.name} items={allowed} onNavigate={name => setView({ name } as View)}
      onSignOut={async () => { try { await call('POST', '/platform/auth/logout'); } catch { /* ignore */ } session.set(null); setMe(null); }}>{body}</Shell>;
  }

  return <LanguageContext.Provider value={language}>
    <StepUpContext.Provider value={askStepUp}>
      <div className="console">
        <LanguageSelect value={language} onChange={changeLanguage} />
        {content}
        {stepUpOpen ? <StepUpDialog onDone={closeStepUp} /> : null}
      </div>
    </StepUpContext.Provider>
  </LanguageContext.Provider>;
}

function LanguageSelect({ value, onChange }: { value: Language; onChange: (v: Language) => void }) {
  return <select className="lang" aria-label="Language" value={value} onChange={e => onChange(normalizeLanguage(e.target.value))}>
    <option value="th">ไทย</option><option value="en">English</option>
  </select>;
}

function Shell({ me, view, items, onNavigate, onSignOut, children }: { me: Me; view: string; items: typeof nav; onNavigate: (name: View['name']) => void; onSignOut: () => void; children: ReactNode }) {
  const t = useText();
  return <div className="shell">
    <aside className="side">
      <div className="logo">{t('consoleTitle')}</div>
      <nav>{items.map(n => <button key={n.name} className={view === n.name || (view === 'invoice' && n.name === 'payments') ? 'nav on' : 'nav'} onClick={() => onNavigate(n.name)}>{t(n.key)}</button>)}</nav>
      <div className="who"><strong>{me.display_name}</strong><span>{me.email}</span><span className="muted">{t('roles')}: {me.roles.join(', ')}</span>
        <button className="ghost" onClick={onSignOut}>{t('signOut')}</button></div>
    </aside>
    <main className="work">{children}</main>
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
  return <form className="signin" onSubmit={submit}>
    <h1>{t('consoleTitle')}</h1>
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
  </form>;
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
      <h2 id="stepup-title">{t('stepUpTitle')}</h2><p className="muted">{t('stepUpHint')}</p>
      <label>{t('code')}<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></label>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="row"><button type="button" className="ghost" onClick={() => onDone(false)}>{t('cancel')}</button><button className="primary" disabled={busy}>{t('confirm')}</button></div>
    </form>
  </div>;
}
