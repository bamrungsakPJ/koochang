'use client';
import { normalizeLanguage, type Language } from '@field-service/core';
import { adminText, type AdminKey } from '@field-service/i18n';
import { createContext, useContext } from 'react';

const base = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/v1`;
const tokenKey = 'console.session';

export class ConsoleError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly fieldErrors: Record<string, string> = {}) { super(message); }
}

/** Platform session token lives in sessionStorage only (closing the tab signs out). */
export const session = {
  get: () => { try { return sessionStorage.getItem(tokenKey); } catch { return null; } },
  set: (token: string | null) => { try { if (token) sessionStorage.setItem(tokenKey, token); else sessionStorage.removeItem(tokenKey); } catch { /* ignore */ } },
};

let language: Language = 'th';
export function setApiLanguage(value: Language) { language = value; }
export let onSignedOut: () => void = () => {};
export function setOnSignedOut(fn: () => void) { onSignedOut = fn; }

export async function call<T = unknown>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  let response: Response;
  try {
    const token = session.get();
    response = await fetch(`${base}${path}`, {
      method, headers: { 'content-type': 'application/json', 'accept-language': language, ...(auth && token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new ConsoleError(0, 'NETWORK_ERROR', adminText(language, 'networkError')); }
  const text = await response.text();
  let data: { code?: string; message?: string; field_errors?: Record<string, string> } | null = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (response.ok) return data as T;
  if (auth && response.status === 401) { session.set(null); onSignedOut(); }
  throw new ConsoleError(response.status, data?.code ?? 'INTERNAL_ERROR', data?.message ?? '', data?.field_errors ?? {});
}

/** Authenticated binary download (proof images, CSV) as an object URL. */
export async function download(path: string): Promise<{ url: string; type: string }> {
  const response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${session.get() ?? ''}`, 'accept-language': language } });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { code?: string; message?: string } | null;
    throw new ConsoleError(response.status, data?.code ?? 'INTERNAL_ERROR', data?.message ?? '');
  }
  const blob = await response.blob();
  return { url: URL.createObjectURL(blob), type: blob.type };
}

export interface Me { id: string; display_name: string; email: string; preferred_language: string; roles: string[]; permissions: string[] }

export const LanguageContext = createContext<Language>('th');
export function useText() {
  const lang = useContext(LanguageContext);
  return (key: AdminKey, params?: Record<string, string | number>) => adminText(lang, key, params);
}
export function useLanguage() { return useContext(LanguageContext); }
export { normalizeLanguage };

/** Runs a money/access action; when the server asks for step-up, prompts for a code and retries once. */
export const StepUpContext = createContext<() => Promise<boolean>>(async () => false);
export function useStepUp() {
  const ask = useContext(StepUpContext);
  return async <T,>(action: () => Promise<T>): Promise<T> => {
    try { return await action(); }
    catch (error) {
      if (error instanceof ConsoleError && error.code === 'STEP_UP_REQUIRED' && await ask()) return action();
      throw error;
    }
  };
}

export const money = (minor: number | string, lang: Language) =>
  new Intl.NumberFormat(lang === 'th' ? 'th-TH' : 'en-GB', { style: 'currency', currency: 'THB', currencyDisplay: 'code' }).format(Number(minor) / 100);
export const dateTime = (value: string | Date | null | undefined, lang: Language) => value
  ? new Intl.DateTimeFormat(lang === 'th' ? 'th-TH-u-ca-buddhist' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value)) : '—';
export const dateOnly = (value: string | Date | null | undefined, lang: Language) => value
  ? new Intl.DateTimeFormat(lang === 'th' ? 'th-TH-u-ca-buddhist' : 'en-GB', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(new Date(value)) : '—';
