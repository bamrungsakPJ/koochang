import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../api/client';
import type { JobSummary } from '../../api/types';
import { StatusBadge } from '../../components/domain';
import { Card } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';

const tabs = [
  { key: 'open', label: 'เปิดอยู่', query: 'status=open' },
  { key: 'unassigned', label: 'ยังไม่มอบหมาย', query: 'status=open&assignee=none' },
  { key: 'parts', label: 'รออะไหล่', query: 'status=WAITING_PART' },
  { key: 'return', label: 'ต้องกลับไป', query: 'status=NEED_RETURN_VISIT' },
  { key: 'closed', label: 'ปิดแล้ว', query: 'status=closed' },
];

export function Jobs() {
  const [params, setParams] = useSearchParams();
  const tab = tabs.find((t) => t.key === params.get('tab')) ?? tabs[0];
  const jobs = useQuery({ queryKey: ['jobs', tab.key], queryFn: () => api<JobSummary[]>(`/jobs?${tab.query}`) });

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">งาน</h1>
        <Link
          to="/admin/jobs/new"
          className="inline-flex min-h-11 items-center rounded-xl bg-brand-700 px-4 font-medium text-white hover:bg-brand-800"
        >
          + สร้างงาน
        </Link>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setParams({ tab: t.key })}
            className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-medium ${
              t.key === tab.key ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card className="p-0">
        <ul className="divide-y divide-slate-100">
          {jobs.isPending && <li className="p-4 text-slate-500">กำลังโหลด…</li>}
          {jobs.data?.length === 0 && <li className="p-4 text-slate-500">ไม่มีงาน</li>}
          {jobs.data?.map((j) => (
            <li key={j.id}>
              <Link to={`/admin/jobs/${j.id}`} className="flex items-start justify-between gap-3 p-4 hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="font-medium">{j.customerName}</span>
                  <span className="text-slate-500"> · {j.jobNo}</span>
                  <span className="block truncate text-sm text-slate-600">
                    {[j.assetLabel, j.issueType].filter(Boolean).join(' — ') || 'ไม่ระบุเครื่อง'}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {fmtDateTime(j.createdAt)} · {j.assignee ? `ช่าง ${j.assignee.displayName}` : 'ยังไม่มอบหมาย'}
                  </span>
                </span>
                <StatusBadge status={j.status} />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
