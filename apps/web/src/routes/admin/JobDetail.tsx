import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WorkType, workTypeLabel } from '@serviceflow/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../../api/client';
import type { JobDetail as Job, Member } from '../../api/types';
import { Chips, StatusBadge, Timeline, workLabel } from '../../components/domain';
import { Button, Card, ErrorText, Input, Spinner, errorMessage } from '../../components/ui';
import { fmtDate, mapUrl, telUrl } from '../../lib/format';

export function JobDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const job = useQuery({ queryKey: ['job', id], queryFn: () => api<Job>(`/jobs/${id}`) });
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<Member[]>('/memberships') });
  const [assignee, setAssignee] = useState('');
  const [closing, setClosing] = useState(false);
  const [workTypes, setWorkTypes] = useState<string[]>([]);
  const [closeNote, setCloseNote] = useState('');

  const act = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) =>
      api<Job>(`/jobs/${id}/${action}`, { method: 'POST', body: body ?? {} }),
    onSuccess: (j) => {
      qc.setQueryData(['job', id], j);
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      setClosing(false);
    },
  });

  if (job.isPending) return <Spinner />;
  if (job.isError) return <p className="text-red-600">{job.error.message}</p>;
  const j = job.data;
  const can = (a: string) => j.allowedActions.includes(a as never);
  const map = mapUrl(j.site);
  const technicians = (members.data ?? []).filter((m) => m.role === 'TECHNICIAN');

  return (
    <div className="space-y-6">
      <div>
        <Link to="/admin/jobs" className="text-sm text-slate-500 hover:underline">
          ← งาน
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{j.jobNo}</h1>
          <StatusBadge status={j.status} />
        </div>
        <p className="text-slate-600">{[j.issueType, j.issueNote].filter(Boolean).join(' — ') || 'ไม่ระบุอาการ'}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-1">
          <p className="text-xs text-slate-500">ลูกค้า</p>
          <Link to={`/admin/customers/${j.customer.id}`} className="font-medium hover:underline">
            {j.customer.displayName}
          </Link>
          {j.customer.phone && (
            <a href={telUrl(j.customer.phone)!} className="block text-brand-700">
              📞 {j.customer.phone}
            </a>
          )}
          {j.site && <p className="text-sm text-slate-600">{j.site.displayName}</p>}
          {map && (
            <a href={map} target="_blank" rel="noreferrer" className="block text-sm text-brand-700">
              📍 เปิดแผนที่
            </a>
          )}
        </Card>
        <Card className="flex gap-3">
          {j.asset?.photoUrl && <img src={j.asset.photoUrl} alt="" className="size-16 rounded-xl object-cover" />}
          <div>
            <p className="text-xs text-slate-500">เครื่อง</p>
            {j.asset ? (
              <Link to={`/admin/assets/${j.asset.id}`} className="font-medium hover:underline">
                {j.asset.label}
              </Link>
            ) : (
              <p className="text-slate-500">ไม่ระบุ</p>
            )}
            {j.asset?.serialNumber && <p className="text-sm text-slate-500">SN: {j.asset.serialNumber}</p>}
            {j.asset?.installedAt && <p className="text-sm text-slate-500">ติดตั้ง {fmtDate(j.asset.installedAt)}</p>}
          </div>
        </Card>
      </div>

      {(can('assign') || can('cancel') || can('complete')) && (
        <Card className="space-y-4">
          {can('assign') && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-600">ช่าง: {j.assignee?.displayName ?? 'ยังไม่มอบหมาย'}</span>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="min-h-11 flex-1 rounded-xl border border-slate-300 bg-white px-3"
                aria-label="เลือกช่าง"
              >
                <option value="">เลือกช่าง…</option>
                {technicians.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
              <Button
                disabled={!assignee}
                loading={act.isPending && act.variables?.action === 'assign'}
                onClick={() => act.mutate({ action: 'assign', body: { assigneeId: assignee } })}
              >
                {j.assignee ? 'มอบหมายใหม่' : 'มอบหมาย'}
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {can('complete') && !closing && (
              <Button variant="secondary" onClick={() => setClosing(true)}>
                ปิดงาน (ไม่ต้องไปหน้างาน)
              </Button>
            )}
            {can('cancel') && (
              <Button
                variant="danger"
                loading={act.isPending && act.variables?.action === 'cancel'}
                onClick={() => {
                  const reason = prompt('เหตุผลที่ยกเลิก (ไม่บังคับ)');
                  if (reason !== null) act.mutate({ action: 'cancel', body: { reason: reason || undefined } });
                }}
              >
                ยกเลิกงาน
              </Button>
            )}
          </div>
          {closing && (
            <div className="space-y-3 rounded-xl bg-slate-50 p-4">
              <p className="font-medium">ทำอะไรไป?</p>
              <Chips
                multiple
                options={Object.values(WorkType).map((w) => ({ value: w, label: workTypeLabel[w] }))}
                value={workTypes}
                onChange={setWorkTypes}
              />
              <Input placeholder="หมายเหตุ (ไม่บังคับ)" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} />
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setClosing(false)}>
                  ยกเลิก
                </Button>
                <Button
                  disabled={!workTypes.length}
                  loading={act.isPending && act.variables?.action === 'complete'}
                  onClick={() => act.mutate({ action: 'complete', body: { workTypes, note: closeNote || undefined } })}
                >
                  ปิดงาน
                </Button>
              </div>
            </div>
          )}
          <ErrorText>{act.error && errorMessage(act.error)}</ErrorText>
        </Card>
      )}

      {j.status === 'COMPLETED' && j.outcome && (
        <Card className="space-y-2">
          <h2 className="font-semibold">ผลการทำงาน</h2>
          <p>{j.outcome.workTypes.map(workLabel).join(', ')}</p>
          {j.partsUsed.length > 0 && (
            <ul className="text-sm text-slate-700">
              {j.partsUsed.map((p, i) => (
                <li key={i}>
                  • {p.name} {p.spec} {p.qty > 1 ? `x${p.qty}` : ''}
                </li>
              ))}
            </ul>
          )}
          {j.outcome.note && <p className="text-sm text-slate-600">{j.outcome.note}</p>}
        </Card>
      )}

      {j.partRequests.length > 0 && (
        <Card>
          <h2 className="mb-2 font-semibold">อะไหล่ที่ต้องใช้</h2>
          <ul className="space-y-1 text-sm">
            {j.partRequests.map((p) => (
              <li key={p.id}>
                {p.description ?? 'ดูรูป'} <span className="text-slate-500">· {p.status === 'REQUESTED' ? 'รออะไหล่' : 'ได้แล้ว'}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {j.photos.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">รูปจากหน้างาน</h2>
          <div className="flex flex-wrap gap-2">
            {j.photos.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                <img src={p.url} alt="" className="size-24 rounded-xl border border-slate-200 object-cover" />
              </a>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-semibold">ความคืบหน้า</h2>
        <Timeline items={j.events} linkJobs={false} />
      </section>
    </div>
  );
}
