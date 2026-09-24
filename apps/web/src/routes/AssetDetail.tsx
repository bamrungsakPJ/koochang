import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { api } from '../api/client';
import type { AssetDetail as Asset } from '../api/types';
import { StatusBadge, Timeline } from '../components/domain';
import { Card, Spinner } from '../components/ui';
import { fmtDate, mapUrl, telUrl } from '../lib/format';

/** Shared by /admin/assets/:id and /tech/assets/:id. */
export function AssetDetail({ basePath }: { basePath: '/admin' | '/tech' }) {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['asset', id], queryFn: () => api<Asset>(`/assets/${id}`) });
  if (q.isPending) return <Spinner />;
  if (q.isError) return <p className="text-red-600">{q.error.message}</p>;
  const a = q.data;
  const map = mapUrl(a.site);
  const isAdmin = basePath === '/admin';

  const rows: [string, string | null][] = [
    ['ประเภท', a.category?.name ?? null],
    ['ยี่ห้อ', a.brand],
    ['รุ่น', a.model],
    ['Serial', a.serialNumber],
    ['ติดตั้ง', a.installedAt ? `${fmtDate(a.installedAt)}${a.installedBy ? ` · ${a.installedBy}` : ''}` : null],
    ['ประกันถึง', a.warrantyEnd ? fmtDate(a.warrantyEnd) : null],
    ['รอบบริการถัดไป', a.nextServiceDate ? fmtDate(a.nextServiceDate) : null],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {isAdmin && (
            <Link to={`/admin/customers/${a.customer.id}`} className="text-sm text-slate-500 hover:underline">
              ← {a.customer.displayName}
            </Link>
          )}
          <h1 className="text-2xl font-semibold">{a.label}</h1>
          {!isAdmin && <p className="text-slate-600">{a.customer.displayName}</p>}
        </div>
        {isAdmin && (
          <Link
            to={`/admin/jobs/new?assetId=${a.id}`}
            className="inline-flex min-h-11 items-center rounded-xl bg-brand-700 px-4 font-medium text-white hover:bg-brand-800"
          >
            + สร้างงาน
          </Link>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          {a.photoUrl ? (
            <img src={a.photoUrl} alt="รูปเครื่อง" className="aspect-square w-full rounded-2xl border border-slate-200 object-cover" />
          ) : (
            <div className="grid aspect-square w-full place-items-center rounded-2xl bg-slate-100 text-5xl">🔧</div>
          )}
          <Card className="space-y-1 text-sm">
            <p className="font-medium">{a.customer.displayName}</p>
            {a.customer.phone && (
              <a href={telUrl(a.customer.phone)!} className="block text-brand-700">
                📞 {a.customer.phone}
              </a>
            )}
            {a.site && <p className="text-slate-600">{a.site.displayName}</p>}
            {map && (
              <a href={map} target="_blank" rel="noreferrer" className="block text-brand-700">
                📍 เปิดแผนที่
              </a>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className={v ? '' : 'text-slate-400'}>{v ?? 'ยังไม่ระบุ'}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {a.openJobs.length > 0 && (
            <section>
              <h2 className="mb-2 font-semibold">งานที่เปิดอยู่</h2>
              <div className="space-y-2">
                {a.openJobs.map((j) => (
                  <Link
                    key={j.id}
                    to={`${basePath}/jobs/${j.id}`}
                    className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3 hover:border-brand-600"
                  >
                    <span>
                      <span className="font-medium">{j.jobNo}</span> {j.issueType}
                    </span>
                    <StatusBadge status={j.status} />
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 font-semibold">ประวัติเครื่อง</h2>
            <Timeline items={a.timeline} dateOnly linkJobs={isAdmin} />
          </section>
        </div>
      </div>
    </div>
  );
}
