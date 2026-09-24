import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WorkType, workTypeLabel } from '@serviceflow/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, type UploadedMedia } from '../../api/client';
import type { JobDetail } from '../../api/types';
import { Chips, PhotoPicker, StatusBadge, workLabel } from '../../components/domain';
import { Button, Card, ErrorText, Input, Spinner, errorMessage } from '../../components/ui';
import { fmtDate, mapUrl, telUrl } from '../../lib/format';

type Sheet = null | { kind: 'complete'; preset: string[] } | { kind: 'need-part' } | { kind: 'need-return' };

interface PartRow {
  name: string;
  spec: string;
  qty: number;
}

/**
 * Technician job screen (req §14–16): no long form — status buttons, then
 * "what was done" as chips, optional parts and photos.
 */
export function TechJob() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const job = useQuery({ queryKey: ['job', id], queryFn: () => api<JobDetail>(`/jobs/${id}`) });
  const [sheet, setSheet] = useState<Sheet>(null);

  const act = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) =>
      api<JobDetail>(`/jobs/${id}/${action}`, { method: 'POST', body: body ?? {} }),
    onSuccess: (j, v) => {
      qc.setQueryData(['job', id], j);
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      setSheet(null);
      if (v.action === 'complete' || v.action === 'need-part' || v.action === 'need-return') navigate('/tech', { replace: true });
    },
  });

  if (job.isPending) return <Spinner />;
  if (job.isError) return <p className="text-red-600">{job.error.message}</p>;
  const j = job.data;
  const can = (a: string) => j.allowedActions.includes(a as never);
  const busy = (a: string) => act.isPending && act.variables?.action === a;
  const map = mapUrl(j.site);
  const warranty = j.asset?.warrantyEnd ? (new Date(j.asset.warrantyEnd) > new Date() ? 'อยู่ในประกัน' : 'หมดประกัน') : 'ไม่ทราบ';

  if (sheet?.kind === 'complete') return <CompleteSheet preset={sheet.preset} busy={busy('complete')} error={act.error} onCancel={() => setSheet(null)} onSubmit={(body) => act.mutate({ action: 'complete', body })} />;
  if (sheet?.kind === 'need-part') return <NeedPartSheet busy={busy('need-part')} error={act.error} onCancel={() => setSheet(null)} onSubmit={(body) => act.mutate({ action: 'need-part', body })} />;
  if (sheet?.kind === 'need-return') return <NeedReturnSheet busy={busy('need-return')} error={act.error} onCancel={() => setSheet(null)} onSubmit={(body) => act.mutate({ action: 'need-return', body })} />;

  return (
    <div className="space-y-4 pb-40">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">{j.jobNo}</span>
        <StatusBadge status={j.status} />
      </div>

      <Card className="space-y-2">
        <p className="text-xl font-semibold">{j.customer.displayName}</p>
        <div className="flex flex-wrap gap-2">
          {j.customer.phone && (
            <a href={telUrl(j.customer.phone)!} className="inline-flex min-h-11 items-center rounded-xl bg-slate-100 px-4 font-medium">
              📞 โทร
            </a>
          )}
          {map && (
            <a href={map} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-xl bg-slate-100 px-4 font-medium">
              📍 นำทาง
            </a>
          )}
        </div>
        {j.site && <p className="text-sm text-slate-600">{[j.site.displayName, j.site.addressText].filter(Boolean).join(' · ')}</p>}
      </Card>

      <Card className="space-y-1">
        <div className="flex gap-3">
          {j.asset?.photoUrl && <img src={j.asset.photoUrl} alt="" className="size-16 rounded-xl object-cover" />}
          <div className="min-w-0">
            {j.asset ? (
              <Link to={`/tech/assets/${j.asset.id}`} className="font-semibold underline-offset-2 hover:underline">
                {j.asset.label}
              </Link>
            ) : (
              <p className="font-semibold">ไม่ระบุเครื่อง</p>
            )}
            {j.asset?.serialNumber && <p className="text-sm text-slate-500">SN: {j.asset.serialNumber}</p>}
            <p className="text-sm text-slate-500">ประกัน: {warranty}</p>
          </div>
        </div>
        <p className="pt-2 text-lg">
          <span className="text-slate-500">อาการ:</span> {j.issueType ?? '—'}
        </p>
        {j.issueNote && <p className="text-slate-700">{j.issueNote}</p>}
        {j.returnNote && <p className="text-sm text-rose-700">ครั้งก่อน: {j.returnNote}</p>}
      </Card>

      {j.previousService.length > 0 && (
        <Card>
          <p className="mb-2 font-medium">บริการครั้งก่อน</p>
          <ul className="space-y-1 text-sm">
            {j.previousService.map((p) => (
              <li key={p.id}>
                <span className="text-slate-500">{fmtDate(p.completedAt)}</span> {p.workTypes.map(workLabel).join(', ')}
                {p.parts.length > 0 && <span className="text-slate-600"> · {p.parts.join(', ')}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {j.status === 'COMPLETED' && j.outcome && (
        <Card>
          <p className="font-medium">✓ ปิดงานแล้ว</p>
          <p>{j.outcome.workTypes.map(workLabel).join(', ')}</p>
        </Card>
      )}

      <ErrorText>{act.error && errorMessage(act.error)}</ErrorText>

      {/* Primary action pinned to the bottom: one tap per step. */}
      {j.allowedActions.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-4 backdrop-blur">
          <div className="mx-auto max-w-md space-y-2">
            {can('accept') && (
              <Button className="w-full min-h-14 text-lg" loading={busy('accept')} onClick={() => act.mutate({ action: 'accept' })}>
                รับงาน
              </Button>
            )}
            {(can('on-the-way') || can('arrive')) && (
              <div className="flex gap-2">
                {can('on-the-way') && (
                  <Button variant="secondary" className="min-h-14 flex-1" loading={busy('on-the-way')} onClick={() => act.mutate({ action: 'on-the-way' })}>
                    กำลังเดินทาง
                  </Button>
                )}
                {can('arrive') && (
                  <Button className="min-h-14 flex-1 text-lg" loading={busy('arrive')} onClick={() => act.mutate({ action: 'arrive' })}>
                    ถึงหน้างาน
                  </Button>
                )}
              </div>
            )}
            {can('complete') && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Button className="min-h-14" onClick={() => setSheet({ kind: 'complete', preset: ['CLEAN_PM'] })}>
                    ล้าง/PM
                  </Button>
                  <Button className="min-h-14" onClick={() => setSheet({ kind: 'complete', preset: ['REPAIR'] })}>
                    ซ่อม
                  </Button>
                  <Button className="min-h-14" onClick={() => setSheet({ kind: 'complete', preset: ['REPLACE_PART'] })}>
                    เปลี่ยนอะไหล่
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {can('need-part') && (
                    <Button variant="secondary" className="min-h-12" onClick={() => setSheet({ kind: 'need-part' })}>
                      ต้องใช้อะไหล่
                    </Button>
                  )}
                  {can('need-return') && (
                    <Button variant="secondary" className="min-h-12" onClick={() => setSheet({ kind: 'need-return' })}>
                      ต้องกลับมาอีกครั้ง
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SheetShell({ title, children, onCancel }: { title: string; children: React.ReactNode; onCancel: () => void }) {
  return (
    <div className="space-y-5 pb-28">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{title}</h1>
        <button className="text-slate-600" onClick={onCancel}>
          ยกเลิก
        </button>
      </div>
      {children}
    </div>
  );
}

function SubmitBar({ label, busy, disabled, onClick }: { label: string; busy: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-4 backdrop-blur">
      <div className="mx-auto max-w-md">
        <Button className="min-h-14 w-full text-lg" loading={busy} disabled={disabled} onClick={onClick}>
          {label}
        </Button>
      </div>
    </div>
  );
}

function CompleteSheet({
  preset,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  preset: string[];
  busy: boolean;
  error: unknown;
  onCancel: () => void;
  onSubmit: (body: unknown) => void;
}) {
  const [workTypes, setWorkTypes] = useState<string[]>(preset);
  const [parts, setParts] = useState<PartRow[]>(preset.includes('REPLACE_PART') ? [{ name: '', spec: '', qty: 1 }] : []);
  const [before, setBefore] = useState<UploadedMedia[]>([]);
  const [after, setAfter] = useState<UploadedMedia[]>([]);
  const [note, setNote] = useState('');
  const update = (i: number, p: Partial<PartRow>) => setParts(parts.map((row, k) => (k === i ? { ...row, ...p } : row)));

  return (
    <SheetShell title="ปิดงาน" onCancel={onCancel}>
      <section className="space-y-2">
        <p className="font-medium">ทำอะไรไป?</p>
        <Chips
          multiple
          options={Object.values(WorkType).map((w) => ({ value: w, label: workTypeLabel[w] }))}
          value={workTypes}
          onChange={setWorkTypes}
        />
      </section>

      {(workTypes.includes('REPLACE_PART') || parts.length > 0) && (
        <section className="space-y-2">
          <p className="font-medium">อะไหล่ที่เปลี่ยน</p>
          {parts.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_5rem_4rem] gap-2">
              <Input placeholder="ชื่อ เช่น Capacitor" value={p.name} onChange={(e) => update(i, { name: e.target.value })} />
              <Input placeholder="สเปก" value={p.spec} onChange={(e) => update(i, { spec: e.target.value })} />
              <Input
                inputMode="numeric"
                aria-label="จำนวน"
                value={p.qty}
                onChange={(e) => update(i, { qty: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })}
              />
            </div>
          ))}
          <button type="button" className="text-sm font-medium text-brand-700" onClick={() => setParts([...parts, { name: '', spec: '', qty: 1 }])}>
            + เพิ่มอะไหล่
          </button>
        </section>
      )}

      <section className="grid grid-cols-2 gap-4">
        <div>
          <p className="mb-2 text-sm font-medium">ก่อนทำ (ไม่บังคับ)</p>
          <PhotoPicker kind="BEFORE" photos={before} onChange={setBefore} max={3} label="ก่อน" />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">หลังทำ (ไม่บังคับ)</p>
          <PhotoPicker kind="AFTER" photos={after} onChange={setAfter} max={3} label="หลัง" />
        </div>
      </section>

      <Input placeholder="หมายเหตุ (ไม่บังคับ)" value={note} onChange={(e) => setNote(e.target.value)} />
      <ErrorText>{error ? errorMessage(error) : null}</ErrorText>
      <SubmitBar
        label="ปิดงาน"
        busy={busy}
        disabled={!workTypes.length}
        onClick={() =>
          onSubmit({
            workTypes,
            parts: parts.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), spec: p.spec.trim() || undefined, qty: p.qty })),
            mediaIds: [...before, ...after].map((m) => m.id),
            note: note || undefined,
          })
        }
      />
    </SheetShell>
  );
}

function NeedPartSheet({ busy, error, onCancel, onSubmit }: { busy: boolean; error: unknown; onCancel: () => void; onSubmit: (b: unknown) => void }) {
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<UploadedMedia[]>([]);
  return (
    <SheetShell title="ต้องใช้อะไหล่" onCancel={onCancel}>
      <p className="text-slate-600">บอกชื่อ หรือถ่ายรูปอะไหล่อย่างใดอย่างหนึ่งก็พอ</p>
      <Input placeholder="ชื่ออะไหล่" value={description} onChange={(e) => setDescription(e.target.value)} autoFocus />
      <PhotoPicker kind="PART" photos={photos} onChange={setPhotos} max={1} label="รูปอะไหล่" />
      <ErrorText>{error ? errorMessage(error) : null}</ErrorText>
      <SubmitBar
        label="แจ้งรออะไหล่"
        busy={busy}
        disabled={!description.trim() && !photos.length}
        onClick={() => onSubmit({ description: description.trim() || undefined, mediaId: photos[0]?.id })}
      />
    </SheetShell>
  );
}

function NeedReturnSheet({ busy, error, onCancel, onSubmit }: { busy: boolean; error: unknown; onCancel: () => void; onSubmit: (b: unknown) => void }) {
  const reasons = ['ลูกค้าไม่อยู่', 'ต้องใช้เครื่องมือเพิ่ม', 'ต้องมีช่างเพิ่ม', 'หมดเวลา'];
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  return (
    <SheetShell title="ต้องกลับมาอีกครั้ง" onCancel={onCancel}>
      <Chips options={reasons.map((r) => ({ value: r, label: r }))} value={picked} onChange={setPicked} />
      <Input placeholder="รายละเอียด (ไม่บังคับ)" value={note} onChange={(e) => setNote(e.target.value)} />
      <ErrorText>{error ? errorMessage(error) : null}</ErrorText>
      <SubmitBar
        label="บันทึก"
        busy={busy}
        onClick={() => onSubmit({ note: [picked[0], note.trim()].filter(Boolean).join(' — ') || undefined })}
      />
    </SheetShell>
  );
}
