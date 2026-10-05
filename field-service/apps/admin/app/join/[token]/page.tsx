'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Language, normalizeLanguage } from '@field-service/core';
import { translate } from '@field-service/i18n';

type Preview = { state: 'active' | 'closed' | 'invalid'; organization_name: string | null };

/** Landing page for a shop join link opened in a browser (chat apps, camera scans).
 * It only shows the shop name for an active link and hands the token to the mobile app;
 * the join request itself is always made from the app after verifying the phone. */
export default function JoinLanding() {
  const { token } = useParams<{ token: string }>();
  const [language, setLanguage] = useState<Language>('th');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setLanguage(normalizeLanguage(localStorage.getItem('foundation.language') ?? navigator.language)); }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/v1/join-links/${encodeURIComponent(token)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status)).then(setPreview, () => setFailed(true));
  }, [token]);
  function changeLanguage(value: Language) { setLanguage(value); localStorage.setItem('foundation.language', value); }

  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string>) => translate(language, key, params);
  return <main className="join">
    <header><span className="brand">{t('appName')}</span>
      <label>{t('language')} <select value={language} onChange={e => changeLanguage(normalizeLanguage(e.target.value))}>
        <option value="th">ไทย</option><option value="en">English</option></select></label></header>
    <section className="join-card" aria-live="polite">
      {failed ? <><h1>{t('networkError')}</h1></>
        : !preview ? <p>…</p>
        : preview.state === 'active' ? <>
          <p className="eyebrow">{t('joinShop')}</p>
          <h1>{t('joinWebTitle', { shop: preview.organization_name ?? '' })}</h1>
          <p>{t('joinWebBody')}</p>
          <a className="primary" href={`${process.env.NEXT_PUBLIC_APP_JOIN_URL ?? 'koochang://join/'}${token}`}>{t('openInApp')}</a>
          <p className="hint">{t('joinWebInstall')}</p>
        </> : <>
          <h1>{t('linkInvalidTitle')}</h1>
          <p>{preview.state === 'closed' ? t('linkClosedBody') : t('linkInvalidBody')}</p>
        </>}
    </section>
  </main>;
}
