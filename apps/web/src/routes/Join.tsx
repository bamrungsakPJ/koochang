import { useQuery } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, apiSession } from '../api/client';
import { AuthShell, Button, Card, ErrorText, Field, Input, Spinner, errorMessage, roleLabel } from '../components/ui';
import { getDevLineUserId, getLineIdToken, isDevLine, setDevLineUserId } from '../lib/line';

/** Technician opens the invite link (inside LINE) and joins — no phone verification. */
export function Join() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<{ shopName: string; role: string }>(`/public/invites/${token}`),
    retry: false,
  });
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [devUser, setDevUser] = useState(getDevLineUserId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (isDevLine) setDevLineUserId(devUser);
      await apiSession(`/public/invites/${token}/accept`, {
        lineIdToken: await getLineIdToken(displayName),
        displayName,
        phone: phone || undefined,
      });
      navigate('/tech', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (invite.isPending) return <Spinner />;
  if (invite.isError) {
    return (
      <AuthShell title="ลิงก์ใช้ไม่ได้" subtitle={errorMessage(invite.error)}>
        <p className="text-slate-600">กรุณาขอลิงก์ใหม่จากเจ้าของร้าน</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={`เข้าร่วมทีม ${invite.data.shopName}`} subtitle={`ในตำแหน่ง ${roleLabel[invite.data.role] ?? invite.data.role}`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="ชื่อที่ให้ร้านเห็น">
          <Input autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus required />
        </Field>
        <Field label="เบอร์โทร (ไม่บังคับ)" hint="ให้ร้านโทรหาได้">
          <Input inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        {isDevLine && (
          <Card className="border-dashed bg-amber-50">
            <Field label="โหมดทดสอบ: LINE user ID จำลอง" hint="ใช้ค่าเดิมเพื่อเข้าในฐานะช่างคนเดิม">
              <Input value={devUser} onChange={(e) => setDevUser(e.target.value)} required />
            </Field>
          </Card>
        )}
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="line" className="w-full" loading={busy}>
          เข้าร่วมด้วย LINE
        </Button>
      </form>
    </AuthShell>
  );
}
