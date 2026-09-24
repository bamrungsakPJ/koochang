import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { useSession } from '../auth/session';
import { Button, Card, ErrorText, errorMessage, roleLabel } from '../components/ui';
import { lineShareUrl } from '../lib/line';

interface Member {
  id: string;
  role: string;
  displayName: string;
  phone: string | null;
  joinedAt: string;
  isMe: boolean;
}

interface PendingInvite {
  id: string;
  role: string;
  expiresAt: string;
}

interface CreatedInvite extends PendingInvite {
  url: string;
}

const dateFmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });

export function Team() {
  const { activeTenant } = useSession();
  const qc = useQueryClient();
  const canManage = activeTenant?.role === 'OWNER' || activeTenant?.role === 'ADMIN';
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<Member[]>('/memberships') });
  const invites = useQuery({
    queryKey: ['invites'],
    queryFn: () => api<PendingInvite[]>('/invites'),
    enabled: canManage,
  });

  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [role, setRole] = useState('TECHNICIAN');
  const [copied, setCopied] = useState(false);

  const createInvite = useMutation({
    mutationFn: () => api<CreatedInvite>('/invites', { method: 'POST', body: { role } }),
    onSuccess: (invite) => {
      setCreated(invite);
      setCopied(false);
      void qc.invalidateQueries({ queryKey: ['invites'] });
    },
  });
  const revokeInvite = useMutation({
    mutationFn: (id: string) => api(`/invites/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites'] }),
  });
  const removeMember = useMutation({
    mutationFn: (id: string) => api(`/memberships/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });

  const shareText = created
    ? `เชิญเข้าร่วมทีม ${activeTenant?.name} บน ServiceFlow\nกดลิงก์นี้ในแอป LINE เพื่อเข้าร่วม:\n${created.url}`
    : '';

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">ทีมงาน</h1>
          <p className="text-slate-600">{members.data ? `${members.data.length} คน` : ' '}</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            {activeTenant?.role === 'OWNER' && (
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="min-h-11 rounded-xl border border-slate-300 bg-white px-3"
                aria-label="ตำแหน่ง"
              >
                <option value="TECHNICIAN">ช่าง</option>
                <option value="DISPATCHER">ผู้รับงาน</option>
                <option value="ADMIN">แอดมิน</option>
              </select>
            )}
            <Button loading={createInvite.isPending} onClick={() => createInvite.mutate()}>
              + เชิญ{roleLabel[role]}
            </Button>
          </div>
        )}
      </div>

      <ErrorText>{createInvite.error && errorMessage(createInvite.error)}</ErrorText>

      {created && (
        <Card className="border-brand-600 bg-brand-50">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">ลิงก์เชิญ{roleLabel[created.role]}พร้อมแล้ว</h2>
              <p className="text-sm text-slate-600">
                ส่งทาง LINE ให้คนที่จะเข้าร่วม · ใช้ได้ 1 ครั้ง ถึง {dateFmt.format(new Date(created.expiresAt))} · ลิงก์นี้แสดงครั้งเดียว
              </p>
            </div>
            <button className="text-slate-500 hover:text-slate-800" aria-label="ปิด" onClick={() => setCreated(null)}>
              ✕
            </button>
          </div>
          <p className="mt-3 break-all rounded-lg bg-white px-3 py-2 font-mono text-sm">{created.url}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={lineShareUrl(shareText)} target="_blank" rel="noreferrer" className="flex-1">
              <Button variant="line" className="w-full" type="button">
                ส่งทาง LINE
              </Button>
            </a>
            <Button variant="secondary" className="flex-1" onClick={copy}>
              {copied ? 'คัดลอกแล้ว ✓' : 'คัดลอกลิงก์'}
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-0">
        <ul className="divide-y divide-slate-100">
          {members.isPending && <li className="p-5 text-slate-500">กำลังโหลด…</li>}
          {members.data?.map((m) => (
            <li key={m.id} className="flex items-center gap-3 p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-100 font-semibold text-slate-600">
                {m.displayName.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {m.displayName} {m.isMe && <span className="text-sm font-normal text-slate-500">(คุณ)</span>}
                </p>
                <p className="text-sm text-slate-500">
                  {roleLabel[m.role]}
                  {m.phone && ` · ${m.phone}`}
                </p>
              </div>
              {canManage && !m.isMe && (m.role !== 'OWNER' || activeTenant?.role === 'OWNER') && (
                <Button
                  variant="danger"
                  className="min-h-9 px-3 text-sm"
                  loading={removeMember.isPending && removeMember.variables === m.id}
                  onClick={() => {
                    if (confirm(`นำ ${m.displayName} ออกจากร้าน?`)) removeMember.mutate(m.id);
                  }}
                >
                  นำออก
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <ErrorText>{removeMember.error && errorMessage(removeMember.error)}</ErrorText>

      {canManage && !!invites.data?.length && (
        <section>
          <h2 className="mb-2 font-semibold">ลิงก์เชิญที่ยังไม่ถูกใช้</h2>
          <Card className="p-0">
            <ul className="divide-y divide-slate-100">
              {invites.data.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 p-4">
                  <span className="text-sm">
                    เชิญ{roleLabel[i.role]} · หมดอายุ {dateFmt.format(new Date(i.expiresAt))}
                  </span>
                  <Button
                    variant="danger"
                    className="min-h-9 px-3 text-sm"
                    loading={revokeInvite.isPending && revokeInvite.variables === i.id}
                    onClick={() => revokeInvite.mutate(i.id)}
                  >
                    ยกเลิก
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
