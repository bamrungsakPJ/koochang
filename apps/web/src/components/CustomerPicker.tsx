import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { CustomerSummary } from '../api/types';
import { Button, Field, Input } from './ui';

export type PickedCustomer =
  | { kind: 'existing'; id: string; displayName: string; phone: string | null }
  | { kind: 'new'; displayName: string; phone?: string };

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Search first; quick-add only when the customer isn't there (req §8 "Quick Add"). */
export function CustomerPicker({ onPick }: { onPick: (c: PickedCustomer) => void }) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const term = useDebounced(q.trim());
  const results = useQuery({
    queryKey: ['customers', term],
    queryFn: () => api<CustomerSummary[]>(`/customers?q=${encodeURIComponent(term)}&limit=8`),
  });

  if (adding) {
    return (
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <Field label="ชื่อลูกค้า">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="เบอร์โทร (ไม่บังคับ)">
          <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setAdding(false)}>
            ย้อนกลับ
          </Button>
          <Button
            className="flex-1"
            disabled={!name.trim()}
            onClick={() => onPick({ kind: 'new', displayName: name.trim(), phone: phone.trim() || undefined })}
          >
            ใช้ลูกค้าใหม่นี้
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Input placeholder="ค้นชื่อ เบอร์ หรือ Serial" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {results.data?.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-slate-50"
              onClick={() => onPick({ kind: 'existing', id: c.id, displayName: c.displayName, phone: c.phone })}
            >
              <span>
                <span className="font-medium">{c.displayName}</span>
                {c.phone && <span className="block text-sm text-slate-500">{c.phone}</span>}
              </span>
              <span className="text-xs text-slate-500">{c.assetCount} เครื่อง</span>
            </button>
          </li>
        ))}
        {results.data?.length === 0 && <li className="p-3 text-sm text-slate-500">ไม่พบลูกค้า</li>}
        <li>
          <button
            type="button"
            className="w-full p-3 text-left font-medium text-brand-700 hover:bg-brand-50"
            onClick={() => {
              setName(/\d{3,}/.test(q) ? '' : q);
              setPhone(/\d{3,}/.test(q) ? q : '');
              setAdding(true);
            }}
          >
            + เพิ่มลูกค้าใหม่{q && !/\d{3,}/.test(q) ? ` “${q}”` : ''}
          </button>
        </li>
      </ul>
    </div>
  );
}
