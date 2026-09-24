import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api/client';
import type { JobSummary } from '../api/types';
import { useSession } from '../auth/session';
import { StatusBadge } from '../components/domain';
import { Card } from '../components/ui';

const isToday = (v: string | null) => (v ? new Date(v).toDateString() === new Date().toDateString() : false);

/** "What needs handling today?" (req §28). Service-due and revenue sections arrive with M2. */
export function AdminHome() {
  const { session } = useSession();
  const open = useQuery({ queryKey: ['jobs', 'open'], queryFn: () => api<JobSummary[]>('/jobs?status=open') });
  const jobs = open.data ?? [];

  const actions = [
    { label: 'งานใหม่ยังไม่มอบหมาย', count: jobs.filter((j) => !j.assignee).length, tab: 'unassigned', tone: 'text-sky-700' },
    { label: 'รออะไหล่', count: jobs.filter((j) => j.status === 'WAITING_PART').length, tab: 'parts', tone: 'text-orange-700' },
    { label: 'ต้องกลับไปอีกครั้ง', count: jobs.filter((j) => j.status === 'NEED_RETURN_VISIT').length, tab: 'return', tone: 'text-rose-700' },
    { label: 'งานเปิดทั้งหมด', count: jobs.length, tab: 'open', tone: 'text-slate-900' },
  ];
  const onSite = jobs.filter((j) => ['ON_THE_WAY', 'ON_SITE', 'IN_PROGRESS'].includes(j.status));
  const today = jobs.filter((j) => isToday(j.createdAt) || isToday(j.scheduledFor));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">สวัสดี {session?.account.displayName}</h1>
          <p className="text-slate-600">วันนี้มีอะไรต้องจัดการ</p>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/assets/new" className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 font-medium hover:bg-slate-50">
            + เพิ่มเครื่อง
          </Link>
          <Link to="/admin/jobs/new" className="inline-flex min-h-11 items-center rounded-xl bg-brand-700 px-4 font-medium text-white hover:bg-brand-800">
            + สร้างงาน
          </Link>
        </div>
      </div>

      <section>
        <h2 className="mb-2 font-semibold">ต้องจัดการ</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {actions.map((a) => (
            <Link key={a.tab} to={`/admin/jobs?tab=${a.tab}`} className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-600">
              <p className={`text-3xl font-semibold ${a.count ? a.tone : 'text-slate-300'}`}>{open.isPending ? '–' : a.count}</p>
              <p className="text-sm text-slate-600">{a.label}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="mb-2 font-semibold">ช่างที่กำลังทำงาน</h2>
          <Card className="p-0">
            <ul className="divide-y divide-slate-100">
              {onSite.length === 0 && <li className="p-4 text-sm text-slate-500">ไม่มี</li>}
              {onSite.map((j) => (
                <li key={j.id}>
                  <Link to={`/admin/jobs/${j.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50">
                    <span className="text-sm">
                      <span className="font-medium">{j.assignee?.displayName}</span> · {j.customerName}
                    </span>
                    <StatusBadge status={j.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
        <section>
          <h2 className="mb-2 font-semibold">งานวันนี้</h2>
          <Card className="p-0">
            <ul className="divide-y divide-slate-100">
              {today.length === 0 && <li className="p-4 text-sm text-slate-500">ไม่มี</li>}
              {today.map((j) => (
                <li key={j.id}>
                  <Link to={`/admin/jobs/${j.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50">
                    <span className="text-sm">
                      <span className="font-medium">{j.customerName}</span> · {j.issueType ?? j.jobNo}
                    </span>
                    <StatusBadge status={j.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </div>
    </div>
  );
}
