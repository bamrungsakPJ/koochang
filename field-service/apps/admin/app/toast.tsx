'use client';
import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { normalizeLanguage } from '@field-service/core';
import { translate } from '@field-service/i18n';

/** Save feedback for the console and the shop web. The API clients call `notifySave` after every
 * create/update/delete, so each form shows "saved" or "not saved" without its own code. A burst of
 * calls from one action (e.g. several requests for one form) collapses into the latest toast. */
type Toast = { id: number; ok: boolean; detail: string };
let next = 1;
let current: Toast | null = null;
const listeners = new Set<(t: Toast | null) => void>();
function publish(t: Toast | null) { current = t; listeners.forEach(l => l(t)); }

export function notifySave(ok: boolean, detail = '') {
  // A failure is not hidden by a later success from the same burst.
  if (ok && current && !current.ok && Date.now() - current.id < 1500) return;
  publish({ id: Date.now() + next++ % 1000, ok, detail: detail.slice(0, 300) });
}

export function Toaster() {
  const [toast, setToast] = useState<Toast | null>(current);
  useEffect(() => { listeners.add(setToast); return () => { listeners.delete(setToast); }; }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => publish(null), toast.ok ? 3000 : 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  if (!toast) return null;
  const lang = normalizeLanguage(typeof document === 'undefined' ? 'th' : document.documentElement.lang);
  const Icon = toast.ok ? CircleCheck : CircleAlert;
  return <div className="toast-region" aria-live={toast.ok ? 'polite' : 'assertive'}>
    <div className={toast.ok ? 'toast ok' : 'toast fail'} role={toast.ok ? 'status' : 'alert'} key={toast.id}>
      <Icon size={20} aria-hidden />
      <div className="toast-text"><strong>{translate(lang, toast.ok ? 'toastSaved' : 'toastFailed')}</strong>
        {!toast.ok && toast.detail ? <span>{toast.detail}</span> : null}</div>
      <button type="button" className="toast-close" aria-label={translate(lang, 'toastClose')} onClick={() => publish(null)}><X size={16} /></button>
    </div>
  </div>;
}
