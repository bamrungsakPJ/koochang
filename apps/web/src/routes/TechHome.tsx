import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api/client';
import type { JobSummary } from '../api/types';
import { StatusBadge } from '../components/domain';
import { Card } from '../components/ui';
import { fmtDateTime } from '../lib/format';

/** My open jobs, newest first. Accept/arrive happen from here in one or two taps. */
export function TechHome() {
  const jobs = useQuery({
    queryKey: ['jobs', 'mine'],
    queryFn: () => api<JobSummary[]>('/jobs?status=open&assignee=me'),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">งานของฉัน</h1>

      {jobs.isPending && <p className="text-slate-500">กำลังโหลด…</p>}
      {jobs.data?.length === 0 && (
        <Card className="text-center">
          <p className="text-lg font-medium">ยังไม่มีงาน</p>
          <p className="mt-1 text-slate-600">เมื่อร้านมอบหมายงาน จะแสดงที่นี่</p>
        </Card>
      )}

      <div className="space-y-3">
        {jobs.data?.map((j) => (
          <Link key={j.id} to={`/tech/jobs/${j.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 active:bg-slate-50">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold">{j.customerName}</p>
                <p className="truncate text-slate-700">{[j.assetLabel, j.issueType].filter(Boolean).join(' — ') || 'ไม่ระบุเครื่อง'}</p>
                <p className="text-sm text-slate-500">
                  {[j.siteName, fmtDateTime(j.scheduledFor ?? j.createdAt)].filter(Boolean).join(' · ')}
                </p>
              </div>
              <StatusBadge status={j.status} />
            </div>
          </Link>
        ))}
      </div>

      <Link
        to="/tech/assets/new"
        className="flex min-h-14 items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white font-medium text-slate-700"
      >
        + ติดตั้งเครื่องใหม่
      </Link>
    </div>
  );
}
