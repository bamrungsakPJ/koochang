import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { api } from '../../api/client';
import type { CustomerDetail as Customer } from '../../api/types';
import { StatusBadge } from '../../components/domain';
import { Card, Spinner } from '../../components/ui';
import { fmtDate, mapUrl, telUrl } from '../../lib/format';

export function CustomerDetail() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => api<Customer>(`/customers/${id}`) });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <p className="text-red-600">{q.error.message}</p>;
  const c = q.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/admin/customers" className="text-sm text-slate-500 hover:underline">
            ← ลูกค้า
          </Link>
          <h1 className="text-2xl font-semibold">{c.displayName}</h1>
          {c.phone && (
            <a href={telUrl(c.phone)!} className="text-brand-700 hover:underline">
              📞 {c.phone}
            </a>
          )}
        </div>
        <div className="flex gap-2">
          <Link
            to={`/admin/assets/new?customerId=${c.id}`}
            className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 font-medium hover:bg-slate-50"
          >
            + เพิ่มเครื่อง
          </Link>
          <Link
            to={`/admin/jobs/new?customerId=${c.id}`}
            className="inline-flex min-h-11 items-center rounded-xl bg-brand-700 px-4 font-medium text-white hover:bg-brand-800"
          >
            + สร้างงาน
          </Link>
        </div>
      </div>

      <section>
        <h2 className="mb-2 font-semibold">เครื่อง ({c.assets.length})</h2>
        {c.assets.length === 0 ? (
          <Card className="text-slate-500">ยังไม่มีเครื่อง</Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {c.assets.map((a) => (
              <Link key={a.id} to={`/admin/assets/${a.id}`} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-3 hover:border-brand-600">
                {a.photoUrl ? (
                  <img src={a.photoUrl} alt="" className="size-16 rounded-xl object-cover" />
                ) : (
                  <span className="grid size-16 place-items-center rounded-xl bg-slate-100 text-2xl">🔧</span>
                )}
                <span className="min-w-0">
                  <span className="block truncate font-medium">{[a.brand, a.model].filter(Boolean).join(' ') || a.category || 'เครื่อง'}</span>
                  <span className="block text-sm text-slate-500">{[a.category, a.siteName].filter(Boolean).join(' · ')}</span>
                  <span className="block text-xs text-slate-500">ติดตั้ง {fmtDate(a.installedAt)}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">สถานที่</h2>
        <Card className="p-0">
          <ul className="divide-y divide-slate-100">
            {c.sites.length === 0 && <li className="p-4 text-slate-500">ยังไม่มีสถานที่</li>}
            {c.sites.map((s) => {
              const map = mapUrl(s);
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 p-4">
                  <span>
                    <span className="font-medium">{s.displayName}</span>
                    {s.addressText && <span className="block text-sm text-slate-500">{s.addressText}</span>}
                  </span>
                  {map && (
                    <a href={map} target="_blank" rel="noreferrer" className="text-sm text-brand-700 hover:underline">
                      แผนที่
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">งาน</h2>
        <Card className="p-0">
          <ul className="divide-y divide-slate-100">
            {c.jobs.length === 0 && <li className="p-4 text-slate-500">ยังไม่มีงาน</li>}
            {c.jobs.map((j) => (
              <li key={j.id}>
                <Link to={`/admin/jobs/${j.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50">
                  <span>
                    <span className="font-medium">{j.jobNo}</span> <span className="text-slate-600">{j.issueType ?? ''}</span>
                    <span className="block text-sm text-slate-500">
                      {j.assetLabel ?? '—'} · {fmtDate(j.createdAt)}
                    </span>
                  </span>
                  <StatusBadge status={j.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
