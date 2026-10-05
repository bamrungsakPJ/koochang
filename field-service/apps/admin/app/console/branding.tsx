'use client';
import { useRef, useState, type ChangeEvent } from 'react';
import { ImageUp, RotateCcw } from 'lucide-react';
import { call, ConsoleError, dateTime, upload, useLanguage, useText } from './api';
import { brandImageUrl, refreshBranding, useBranding, type Branding } from '../brand';

/** Super admin: upload the logo and the site icon. The API re-encodes every image; the whole
 * product (console, shop web, join page, browser tabs) picks up the change on next load. */
export function BrandingView() {
  const t = useText(), lang = useLanguage();
  const brand = useBranding();
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState(''), [done, setDone] = useState('');
  const inputs = { logo: useRef<HTMLInputElement>(null), favicon: useRef<HTMLInputElement>(null) };

  async function run(key: string, action: (version: number) => Promise<Branding>) {
    if (!brand || busy) return;
    setBusy(key); setError(''); setDone('');
    try { await refreshBranding(await action(brand.version)); setDone(t('brandSaved')); }
    catch (e) {
      if (e instanceof ConsoleError && e.code === 'VERSION_CONFLICT') { await refreshBranding(); setError(t('brandConflict')); }
      else setError(e instanceof ConsoleError && e.code === 'VALIDATION_ERROR' ? t('brandImageError') : e instanceof Error ? e.message : t('settingsError'));
    } finally { setBusy(null); }
  }
  function choose(kind: 'logo' | 'favicon', event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError(t('brandImageError')); setDone(''); return; }
    void run(kind, version => upload<Branding>(`/platform/branding/${kind}?version=${version}`, file));
  }
  const reset = (kind: 'logo' | 'favicon') => run(`reset-${kind}`, version => call<Branding>('POST', '/platform/branding/reset', { kind, version }));

  const card = (kind: 'logo' | 'favicon') => {
    const set = kind === 'logo' ? brand?.logo : brand?.favicon;
    const status = !set ? t('brandDefault') : kind === 'favicon' ? t(brand?.favicon_custom ? 'brandCustom' : 'brandFromLogo') : null;
    const canReset = kind === 'logo' ? brand?.logo : brand?.favicon_custom;
    return <section className="panel brand-card">
      <h2>{t(kind === 'logo' ? 'brandLogo' : 'brandFavicon')}</h2>
      <div className={`brand-preview ${kind}`}>
        {set && brand ? <img src={brandImageUrl(kind, brand.version)} alt={t(kind === 'logo' ? 'brandLogo' : 'brandFavicon')} />
          : <img src="/icon-192.png" alt={t('brandDefault')} />}
      </div>
      {status ? <p className="muted">{status}</p> : null}
      <p className="muted">{t(kind === 'logo' ? 'brandLogoHint' : 'brandFaviconHint')}</p>
      <input ref={inputs[kind]} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => choose(kind, e)} />
      <div className="actions">
        <button type="button" className="primary" disabled={!brand || Boolean(busy)} onClick={() => inputs[kind].current?.click()}>
          <ImageUp size={16} aria-hidden /> {busy === kind ? t('brandUploading') : t('brandUpload')}</button>
        {canReset ? <button type="button" className="ghost" disabled={Boolean(busy)} onClick={() => { void reset(kind); }}>
          <RotateCcw size={16} aria-hidden /> {t(kind === 'logo' ? 'brandResetLogo' : 'brandResetFavicon')}</button> : null}
      </div>
    </section>;
  };

  return <><h1>{t('brandingTitle')}</h1><p className="muted">{t('brandingHint')}</p>
    {error ? <p className="error" role="alert">{error}</p> : null}{done ? <p role="status">{done}</p> : null}
    {brand?.updated_at ? <p className="muted">{t('brandUpdated', { date: dateTime(brand.updated_at, lang) })}</p> : null}
    <div className="brand-grid">{card('logo')}{card('favicon')}</div></>;
}
