'use client';
import { useEffect, useState } from 'react';
import { Language, normalizeLanguage } from '@field-service/core';
import { translate } from '@field-service/i18n';
export default function Home() {
  const [language, setLanguage] = useState<Language>('th');
  const [apiReady, setApiReady] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem('foundation.language');
    setLanguage(normalizeLanguage(saved ?? navigator.language));
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  function changeLanguage(value: Language) { setLanguage(value); localStorage.setItem('foundation.language', value); }
  async function checkApi() {
    try { const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/v1/health`); setApiReady(r.ok); }
    catch { setApiReady(false); }
  }
  return <main>
    <header><span className="brand">{translate(language, 'appName')}</span>
      <label>{translate(language, 'language')} <select value={language} onChange={e => changeLanguage(normalizeLanguage(e.target.value))}>
        <option value="th">ไทย</option><option value="en">English</option>
      </select></label></header>
    <section className="intro"><p className="eyebrow">{translate(language, 'foundation')}</p><h1>{translate(language, 'adminTitle')}</h1>
      <p>{translate(language, 'foundationNotice')}</p></section>
    <section className="modules" aria-label={translate(language, 'platform')}>
      {(['customers','jobs','equipment','maintenance','subscription','platform'] as const).map((key, i) =>
        <article key={key}><span className="number">{String(i+1).padStart(2,'0')}</span><h2>{translate(language, key)}</h2></article>)}
    </section>
    <footer><p role="status">{translate(language, apiReady ? 'apiReady' : 'apiWaiting')}</p><button onClick={checkApi}>{translate(language, 'checkApi')}</button></footer>
  </main>;
}
