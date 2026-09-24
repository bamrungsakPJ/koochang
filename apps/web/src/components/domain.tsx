import { jobStatusLabel, workTypeLabel, type JobStatus, type WorkType } from '@serviceflow/shared';
import { ChangeEvent, useRef, useState } from 'react';
import { Link } from 'react-router';
import { uploadMedia, type UploadedMedia } from '../api/client';
import type { TimelineItem } from '../api/types';
import { fmtDate, fmtDateTime } from '../lib/format';
import { errorMessage } from './ui';

const statusTone: Record<string, string> = {
  NEW: 'bg-sky-100 text-sky-800',
  ASSIGNED: 'bg-indigo-100 text-indigo-800',
  ACCEPTED: 'bg-indigo-100 text-indigo-800',
  ON_THE_WAY: 'bg-violet-100 text-violet-800',
  ON_SITE: 'bg-amber-100 text-amber-800',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  WAITING_PART: 'bg-orange-100 text-orange-800',
  NEED_RETURN_VISIT: 'bg-rose-100 text-rose-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-slate-200 text-slate-600',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusTone[status] ?? 'bg-slate-100'}`}>
      {jobStatusLabel[status as JobStatus] ?? status}
    </span>
  );
}

export const workLabel = (w: string) => workTypeLabel[w as WorkType] ?? w;

/** Toggle chips — tap instead of type (req §2). */
export function Chips({
  options,
  value,
  onChange,
  multiple = false,
}: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  multiple?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(multiple ? (on ? value.filter((v) => v !== o.value) : [...value, o.value]) : on ? [] : [o.value])
            }
            className={`min-h-11 rounded-full border px-4 text-sm font-medium transition-colors ${
              on ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Opens the rear camera on phones; uploads immediately so the final submit is instant. */
export function PhotoPicker({
  kind,
  photos,
  onChange,
  max = 6,
  label = 'ถ่ายรูป',
}: {
  kind: string;
  photos: UploadedMedia[];
  onChange: (p: UploadedMedia[]) => void;
  max?: number;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])].slice(0, max - photos.length);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    setError('');
    try {
      const uploaded: UploadedMedia[] = [];
      for (const f of files) uploaded.push(await uploadMedia(f, kind));
      onChange([...photos, ...uploaded]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <div key={p.id} className="relative">
            <img src={p.url} alt="" className="size-20 rounded-xl border border-slate-200 object-cover" />
            <button
              type="button"
              aria-label="ลบรูป"
              onClick={() => onChange(photos.filter((x) => x.id !== p.id))}
              className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-slate-800 text-xs text-white"
            >
              ✕
            </button>
          </div>
        ))}
        {photos.length < max && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="grid size-20 place-items-center rounded-xl border-2 border-dashed border-slate-300 bg-white text-center text-xs text-slate-600 hover:border-brand-600"
          >
            {busy ? <span className="size-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /> : <>📷<br />{label}</>}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" capture="environment" multiple={max > 1} hidden onChange={pick} />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

const eventText: Record<string, string> = {
  ASSET_INSTALLED: 'ติดตั้ง',
  ASSET_UPDATED: 'แก้ไขข้อมูลเครื่อง',
  JOB_CREATED: 'เปิดงาน',
  TECHNICIAN_ASSIGNED: 'มอบหมายช่าง',
  JOB_ACCEPTED: 'ช่างรับงาน',
  TECHNICIAN_ON_THE_WAY: 'ช่างกำลังเดินทาง',
  TECHNICIAN_ON_SITE: 'ช่างถึงหน้างาน',
  JOB_STARTED: 'เริ่มทำงาน',
  PART_REQUIRED: 'รออะไหล่',
  RETURN_VISIT_REQUIRED: 'ต้องกลับไปอีกครั้ง',
  JOB_COMPLETED: 'งานเสร็จ',
  JOB_CANCELLED: 'ยกเลิกงาน',
};

function eventDetail(e: TimelineItem): string | null {
  const d = e.details as Record<string, unknown>;
  switch (e.type) {
    case 'JOB_CREATED':
      return (d.issueType as string) ?? null;
    case 'TECHNICIAN_ASSIGNED':
      return (d.assigneeName as string) ?? null;
    case 'PART_REQUIRED':
      return (d.part as string) ?? null;
    case 'RETURN_VISIT_REQUIRED':
      return (d.note as string) ?? null;
    case 'JOB_CANCELLED':
      return (d.reason as string) ?? null;
    case 'JOB_COMPLETED': {
      const parts = [
        ((d.workTypes as string[]) ?? []).map(workLabel).join(', '),
        ((d.parts as string[]) ?? []).join(', '),
        d.note as string,
      ].filter(Boolean);
      return parts.join(' · ') || null;
    }
    case 'ASSET_INSTALLED':
      return [d.brand, d.model].filter(Boolean).join(' ') || null;
    default:
      return null;
  }
}

/** Service history: generated from events, never typed by hand (req §18). */
export function Timeline({ items, dateOnly = false, linkJobs = true }: { items: TimelineItem[]; dateOnly?: boolean; linkJobs?: boolean }) {
  if (!items.length) return <p className="text-sm text-slate-500">ยังไม่มีประวัติ</p>;
  return (
    <ol className="relative space-y-4 border-l-2 border-slate-200 pl-5">
      {items.map((e, i) => {
        const detail = eventDetail(e);
        return (
          <li key={`${e.type}-${e.occurredAt}-${i}`} className="relative">
            <span
              className={`absolute top-1.5 -left-[27px] size-3 rounded-full border-2 border-white ${
                e.type === 'JOB_COMPLETED' || e.type === 'ASSET_INSTALLED' ? 'bg-brand-600' : 'bg-slate-400'
              }`}
            />
            <p className="text-xs text-slate-500">{dateOnly ? fmtDate(e.occurredAt) : fmtDateTime(e.occurredAt)}</p>
            <p className="font-medium">
              {eventText[e.type] ?? e.type}
              {e.job && linkJobs && (
                <Link to={`/admin/jobs/${e.job.id}`} className="ml-2 text-sm font-normal text-brand-700 hover:underline">
                  {e.job.jobNo}
                </Link>
              )}
            </p>
            {detail && <p className="text-sm text-slate-700">{detail}</p>}
            {e.actorName && <p className="text-xs text-slate-500">โดย {e.actorName}</p>}
          </li>
        );
      })}
    </ol>
  );
}
