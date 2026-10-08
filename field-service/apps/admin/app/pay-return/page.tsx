'use client';
import { useEffect, useState } from 'react';
import { Language, normalizeLanguage } from '@field-service/core';
import { translate } from '@field-service/i18n';
import { BrandMark } from '../brand';

/** Where Stripe sends an owner who paid (or managed their card) from the mobile app. The phone browser
 * has no sign-in, so this page only hands them back to the app, which refreshes the invoice itself. */
export default function PayReturn() {
  const [language, setLanguage] = useState<Language>('th');
  const [href, setHref] = useState('koochang://billing');
  const [card, setCard] = useState(false);
  useEffect(() => {
    setLanguage(normalizeLanguage(localStorage.getItem('foundation.language') ?? navigator.language));
    setCard(new URLSearchParams(location.search).get('kind') === 'card');
    // Android Chrome opens apps reliably through an intent link; other browsers use the app scheme.
    const target = /Android/i.test(navigator.userAgent) ? 'intent://billing#Intent;scheme=koochang;package=com.koochang.app;end' : 'koochang://billing';
    setHref(target);
    const timer = setTimeout(() => { window.location.href = target; }, 400);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  return <main className="join">
    <header><span className="brand join-brand"><BrandMark />{t('appName')}</span></header>
    <section className="join-card" aria-live="polite">
      <h1>{t(card ? 'payReturn.cardTitle' : 'payReturn.title')}</h1>
      <p>{t(card ? 'payReturn.cardBody' : 'payReturn.body')}</p>
      <a className="primary" href={href}>{t('payReturn.open')}</a>
      <p className="hint">{t('payReturn.hint')}</p>
    </section>
  </main>;
}
