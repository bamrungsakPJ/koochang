'use client';
import { normalizeLanguage, type Language } from '@field-service/core';
import { adminText, type AdminKey } from '@field-service/i18n';
import { createContext, useContext } from 'react';
import { notifySave } from '../toast';

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

/** Create/update/delete calls show a saved / not saved toast; sign-in steps and enrollment setup do not.
 * A step-up request is not a failure: the action is retried after the code is entered. */
export async function call<T = unknown>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const save = method !== 'GET' && !/^\/platform\/(auth\/|enrollment\/setup$)/.test(path);
  try { const result = await send<T>(method, path, body, auth); if (save) notifySave(true); return result; }
  catch (error) {
    if (save && !(error instanceof ConsoleError && error.code === 'STEP_UP_REQUIRED')) notifySave(false, error instanceof Error ? error.message : '');
    throw error;
  }
}

async function send<T>(method: string, path: string, body: unknown, auth: boolean): Promise<T> {
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

/** Authenticated raw file upload (images); the body is the file itself. */
export async function upload<T = unknown>(path: string, file: Blob): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { method: 'POST', body: file,
      headers: { 'content-type': file.type || 'application/octet-stream', 'accept-language': language, authorization: `Bearer ${session.get() ?? ''}` } });
  } catch { throw new ConsoleError(0, 'NETWORK_ERROR', adminText(language, 'networkError')); }
  const data = await response.json().catch(() => null) as { code?: string; message?: string; field_errors?: Record<string, string> } | null;
  if (response.ok) { notifySave(true); return data as T; }
  if (response.status === 401) { session.set(null); onSignedOut(); }
  const error = new ConsoleError(response.status, data?.code ?? 'INTERNAL_ERROR', data?.message ?? '', data?.field_errors ?? {});
  if (error.code !== 'STEP_UP_REQUIRED') notifySave(false, error.message);
  throw error;
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
/** Readable text for a stored code (role, status, source…); unknown codes show as they are. */
export function useCode() {
  const lang = useContext(LanguageContext);
  return (group: string, value: string | null | undefined) => !value ? '—' : (adminText(lang, `${group}.${value}` as AdminKey) || value);
}
/** In-page replacement for prompt()/confirm(). Resolves to the typed text ('' when there is no input) or null when cancelled. */
export interface AskOptions { title: string; message?: string; input?: { label: string; required?: boolean }; confirmText?: string; danger?: boolean }
export const AskContext = createContext<(options: AskOptions) => Promise<string | null>>(async () => null);
export function useAsk() { return useContext(AskContext); }
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

/** A super admin acts without a second approver (owner decision 2026-10-04). */
export const isSuperAdmin = (me: Me) => me.roles.includes('super_admin');
