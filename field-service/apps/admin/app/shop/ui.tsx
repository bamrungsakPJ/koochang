'use client';
import { Children, createContext, useContext, useEffect, useRef, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { catalogs, translate, errorMessage, formatDateTime, formatMoney, type TranslationKey } from '@field-service/i18n';
import type { Language } from '@field-service/core';
import { ApiFailure, api, type Media } from './api';

export const LanguageContext = createContext<Language>('th');
export function useText() { const lang = useContext(LanguageContext); return (key: TranslationKey, params?: Record<string, string | number>) => translate(lang, key, params); }
export function useError() { const lang = useContext(LanguageContext); return (e: unknown) => e instanceof ApiFailure ? errorMessage(lang, e.code) : errorMessage(lang, 'INTERNAL_ERROR'); }
const labelAliases: Record<string, TranslationKey> = {
  'equipmentField.brand': 'brand', 'equipmentField.model': 'model', 'equipmentField.serial_number': 'serial',
  'photoType.nameplate': 'nameplatePhoto', 'photoType.equipment': 'equipmentPhoto',
  'photoType.before': 'beforePhoto', 'photoType.after': 'afterPhoto', 'photoType.issue': 'problemNote', 'photoType.other': 'jobType.other',
};
export function statusText(lang: Language, prefix: string, value: string) { const key = labelAliases[`${prefix}.${value}`] ?? `${prefix}.${value}`; return key in catalogs[lang] ? translate(lang, key as TranslationKey) : value; }
export const uuid = () => crypto.randomUUID();
export const dateTime = (v: string | null | undefined, lang: Language) => v ? formatDateTime(new Date(v), lang) : '—';
export const money = (n: string | number, lang: Language) => formatMoney(Number(n), lang);
/** datetime-local input represents Bangkok time, regardless of browser time zone. */
export const toInstant = (v: string) => v ? new Date(`${v}:00+07:00`).toISOString() : null;
export const fromInstant = (v: string | null) => v ? new Date(new Date(v).getTime() + 7 * 3600000).toISOString().slice(0, 16) : '';
export function Button({ children, onClick, kind = '', busy = false, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: string; busy?: boolean }) {
  return <button type="button" {...props} className={`${kind} ${props.className ?? ''}`} disabled={busy || props.disabled} aria-busy={busy} onClick={onClick}>{children}{busy ? ' …' : ''}</button>;
}
export function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const dateInput = props.type === 'datetime-local' || props.type === 'date';
  return <label>{label}<input {...props} onInput={dateInput ? e => props.onChange?.(e as React.ChangeEvent<HTMLInputElement>) : props.onInput}
    onBlur={dateInput ? e => { props.onChange?.(e as React.ChangeEvent<HTMLInputElement>); props.onBlur?.(e); } : props.onBlur} /></label>;
}
export function Select({ label, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) { return <label>{label}<select {...props}>{children}</select></label>; }
export function Note({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) { return <label>{label}<textarea rows={3} {...props} /></label>; }
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) { return Children.toArray(children).some(v => typeof v !== 'string' || !!v.trim()) ? <p role={error ? 'alert' : 'status'} className={error ? 'error' : 'ok-box'}>{children}</p> : null; }
export function Panel({ title, children }: { title?: string; children: ReactNode }) { return <section className="panel">{title ? <h2>{title}</h2> : null}{children}</section>; }
export function Empty() { const t = useText(); return <p className="muted">{t('ownerWeb.no_records_yet')}</p>; }
export function Pagination({ offset, size, more, busy, onPage }: { offset: number; size: number; more: boolean; busy: boolean; onPage: (offset: number) => void }) {
  const t = useText();
  return <nav className="actions" aria-label={t('ownerWeb.pagination')}>
    <Button disabled={busy || offset === 0} onClick={() => onPage(Math.max(0, offset - size))}>{t('ownerWeb.previousPage')}</Button>
    <span aria-live="polite">{t('ownerWeb.pageNumber', { n: Math.floor(offset / size) + 1 })}</span>
    <Button disabled={busy || !more} onClick={() => onPage(offset + size)}>{t('ownerWeb.nextPage')}</Button>
  </nav>;
}
export function PageTitle({ children, action }: { children: ReactNode; action?: ReactNode }) { return <div className="page-title"><h1>{children}</h1>{action}</div>; }
export function useResource<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState<unknown>(null), [loading, setLoading] = useState(true);
  const generation = useRef(0), loader = useRef(load); loader.current = load;
  const reload = async () => {
    const n = ++generation.current; setLoading(true); setError(null);
    try { const next = await loader.current(); if (n === generation.current) setData(next); }
    catch (e) { if (n === generation.current) setError(e); } finally { if (n === generation.current) setLoading(false); }
  };
  useEffect(() => { setData(null); void reload(); return () => { ++generation.current; }; }, deps);
  return { data, error, loading, reload, setData };
}
export function ResourceState({ resource }: { resource: { error: unknown; loading: boolean; reload: () => Promise<void> } }) {
  const t = useText(), errorText = useError();
  return <>{resource.error ? <Notice error>{errorText(resource.error)} <Button onClick={() => void resource.reload()}>{t('retry')}</Button></Notice> : null}{resource.loading ? <p role="status">{t('loading')}</p> : null}</>;
}
export function useAction() {
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [notice, setNotice] = useState(''); const lock = useRef(false);
  async function run(fn: () => Promise<unknown>, success = '') {
    if (lock.current) return; lock.current = true; setBusy(true); setError(null); setNotice('');
    try { await fn(); setNotice(success); } catch (e) { setError(e); } finally { lock.current = false; setBusy(false); }
  }
  return { busy, error, notice, run, setError };
}
export function ActionState({ action }: { action: { error: unknown; notice: string } }) {
  const errorText = useError(), lang = useContext(LanguageContext);
  const fields = action.error instanceof ApiFailure ? Object.values(action.error.fieldErrors) : [];
  return <><Notice error>{action.error ? errorText(action.error) : ''}{fields.length ? <span> · {Array.from(new Set(fields)).map(k => k in catalogs[lang] ? translate(lang, k as TranslationKey) : errorMessage(lang, 'VALIDATION_ERROR')).join(' · ')}</span> : null}</Notice><Notice>{action.notice}</Notice></>;
}
/** Same file and request key reused if an upload answer is lost. */
export function PhotoUpload({ org, purpose, label, onReady, onBusy }: { org: string; purpose: string; label: string; onReady: (media: Media) => void | Promise<unknown>; onBusy?: (busy: boolean) => void }) {
  const t = useText(), a = useAction(); const [file, setFile] = useState<File | null>(null), [ready, setReady] = useState<Media | null>(null);
  const pending = useRef<{ key: string; media?: Media } | null>(null);
  const busyCallback = useRef(onBusy); busyCallback.current = onBusy;
  useEffect(() => { busyCallback.current?.(a.busy); return () => busyCallback.current?.(false); }, [a.busy]);
  async function upload() {
    if (!file) return;
    await a.run(async () => {
      const request = pending.current ?? (pending.current = { key: uuid() });
      request.media ??= await api.createMedia(org, { request_key: request.key, mime_type: file!.type, byte_size: file!.size, purpose });
      const media = await api.uploadMedia(org, request.media.id, file!, file!.type); await onReady(media); setReady(media);
    });
  }
  return <div className="upload"><label>{label}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={a.busy} onChange={e => { setFile(e.target.files?.[0] ?? null); pending.current = null; setReady(null); }} /></label>
    {file && !ready ? <Button busy={a.busy} onClick={upload}>{t('uploadPhoto')}</Button> : null}
    {ready ? <>{ready.thumbnail_url ? <img src={ready.thumbnail_url} alt={label} /> : null}<span>{t('saved')}</span></> : null}<ActionState action={a} /></div>;
}
