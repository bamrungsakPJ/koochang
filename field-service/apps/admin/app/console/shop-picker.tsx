'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { call, useText } from './api';

export interface ShopPick { id: string; name: string; detail?: string | null }
type Row = { id: string; name: string; owner_name: string | null; owner_phone: string | null; state: string };
const toPick = (r: Row): ShopPick => ({ id: r.id, name: r.name, detail: [r.owner_name, r.owner_phone].filter(Boolean).join(' · ') || null });

/** Several shops picked by typing a shop name or the last 4 digits of the owner's phone (server search,
 * the same as the Shops page). Picked shops show as removable chips; known IDs are resolved to names. */
/** One shop to filter a list by (empty = every shop). */
export function ShopFilter({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const t = useText();
  return <div className="shop-filter"><ShopMultiPicker label={t('filterShop')} value={value ? [value] : []} onChange={ids => onChange(ids.at(-1) ?? null)} /></div>;
}

export function ShopMultiPicker({ label, value, onChange }: { label: string; value: string[]; onChange: (ids: string[]) => void }) {
  const t = useText(), id = useId();
  const [names, setNames] = useState<Record<string, ShopPick>>({});
  const [query, setQuery] = useState(''), [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const [rows, setRows] = useState<ShopPick[] | null>(null), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Name the shops an existing announcement already targets.
  useEffect(() => {
    const unknown = value.filter(v => !names[v]);
    if (!unknown.length) return;
    let live = true;
    void Promise.all(unknown.map(v => call<{ items: Row[] }>('GET', `/platform/shops?q=${encodeURIComponent(v)}`).then(r => r.items.find(x => x.id === v), () => undefined)))
      .then(found => { if (live) setNames(n => ({ ...n, ...Object.fromEntries(found.filter((r): r is Row => !!r).map(r => [r.id, toPick(r)])) })); });
    return () => { live = false; };
  }, [value.join(',')]);
  useEffect(() => {
    if (!open) return;
    let live = true; setBusy(true); setFailed(false);
    const timer = setTimeout(() => {
      call<{ items: Row[] }>('GET', `/platform/shops?q=${encodeURIComponent(query.trim())}`)
        .then(r => { if (live) { setRows(r.items.map(toPick)); setActive(0); } }, () => { if (live) setFailed(true); })
        .finally(() => { if (live) setBusy(false); });
    }, query ? 250 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [open, query]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const items = (rows ?? []).filter(r => !value.includes(r.id));
  function add(p: ShopPick) { setNames(n => ({ ...n, [p.id]: p })); onChange([...value, p.id]); setQuery(''); }
  function key(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive(i => Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))); }
    else if (e.key === 'Enter') { e.preventDefault(); if (open && items[active]) add(items[active]!); }
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Backspace' && !query && value.length) onChange(value.slice(0, -1));
  }
  const listId = `${id}-list`;
  return <div ref={root} className="shop-picker">
    <label htmlFor={`${id}-input`}>{label}</label>
    {value.length ? <ul className="shop-chips" aria-label={t('shopPickerSelected', { n: value.length })}>{value.map(v => <li key={v}>
      <span>{names[v]?.name ?? `${v.slice(0, 8)}…`}</span>
      <button type="button" className="icon-btn" aria-label={`${t('removeShop')} ${names[v]?.name ?? ''}`} onClick={() => onChange(value.filter(x => x !== v))}><X size={14} /></button></li>)}</ul> : null}
    <input id={`${id}-input`} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" autoComplete="off"
      aria-activedescendant={open && items[active] ? `${id}-${active}` : undefined} placeholder={t('shopPickerPlaceholder')}
      value={query} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onKeyDown={key} onChange={e => { setQuery(e.target.value); setOpen(true); }} />
    {open ? <div className="shop-picker-pop"><ul id={listId} role="listbox" aria-label={label}>
      {items.map((o, i) => <li key={o.id} id={`${id}-${i}`} role="option" aria-selected={false} className={i === active ? 'active' : ''}
        onPointerDown={e => e.preventDefault()} onClick={() => add(o)} onPointerEnter={() => setActive(i)}><strong>{o.name}</strong>{o.detail ? <span className="muted">{o.detail}</span> : null}</li>)}
    </ul>{busy ? <p className="note muted" role="status">{t('shopPickerSearching')}</p> : failed ? <p className="note error" role="alert">{t('shopPickerFailed')}</p>
      : !items.length ? <p className="note muted">{t('empty')}</p> : null}</div> : null}
  </div>;
}
