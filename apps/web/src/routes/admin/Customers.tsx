import { useMutation, useQuery } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../api/client';
import type { CustomerDetail, CustomerSummary } from '../../api/types';
import { Button, Card, ErrorText, Field, Input, errorMessage } from '../../components/ui';

export function Customers() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const list = useQuery({
    queryKey: ['customers', term],
    queryFn: () => api<CustomerSummary[]>(`/customers?q=${encodeURIComponent(term)}&limit=50`),
  });
  const create = useMutation({
    mutationFn: () => api<CustomerDetail>('/customers', { method: 'POST', body: { displayName: name, phone: phone || undefined } }),
    onSuccess: (c) => navigate(`/admin/customers/${c.id}`),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">ลูกค้า</h1>
        <Button onClick={() => setAdding((v) => !v)}>{adding ? 'ปิด' : '+ ลูกค้าใหม่'}</Button>
      </div>

      {adding && (
        <Card>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="ชื่อ">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
            </Field>
            <Field label="เบอร์โทร (ไม่บังคับ)">
              <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Button type="submit" loading={create.isPending}>
              บันทึก
            </Button>
          </form>
          <div className="mt-3">
            <ErrorText>{create.error && errorMessage(create.error)}</ErrorText>
          </div>
        </Card>
      )}

      <Input placeholder="ค้นชื่อ เบอร์ สถานที่ หรือ Serial" value={q} onChange={(e) => setQ(e.target.value)} />

      <Card className="p-0">
        <ul className="divide-y divide-slate-100">
          {list.isPending && <li className="p-4 text-slate-500">กำลังโหลด…</li>}
          {list.data?.length === 0 && <li className="p-4 text-slate-500">{term ? 'ไม่พบลูกค้า' : 'ยังไม่มีลูกค้า'}</li>}
          {list.data?.map((c) => (
            <li key={c.id}>
              <Link to={`/admin/customers/${c.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50">
                <span>
                  <span className="font-medium">{c.displayName}</span>
                  {c.phone && <span className="block text-sm text-slate-500">{c.phone}</span>}
                </span>
                <span className="text-sm text-slate-500">{c.assetCount} เครื่อง</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
