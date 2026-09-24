import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { apiSession } from '../api/client';
import { homePath } from '../auth/session';
import { AuthShell, Button, ErrorText, Field, Input, errorMessage } from '../components/ui';
import { getLineIdToken } from '../lib/line';

export function Login() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'password' | 'line' | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy('password');
    try {
      navigate(homePath(await apiSession('/auth/login', { phone, password })), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function lineLogin() {
    setError('');
    setBusy('line');
    try {
      const session = await apiSession('/auth/line', { lineIdToken: await getLineIdToken() });
      navigate(homePath(session), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AuthShell title="เข้าสู่ระบบ" subtitle="สำหรับเจ้าของร้านและแอดมิน">
      <form onSubmit={submit} className="space-y-4">
        <Field label="เบอร์โทร">
          <Input
            inputMode="tel"
            autoComplete="tel"
            placeholder="081-234-5678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </Field>
        <Field label="รหัสผ่าน">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" loading={busy === 'password'}>
          เข้าสู่ระบบ
        </Button>
        <div className="flex justify-between text-sm">
          <Link to="/reset" className="text-slate-600 hover:underline">
            ลืมรหัสผ่าน
          </Link>
          <Link to="/signup" className="font-medium text-brand-700 hover:underline">
            สมัครร้านใหม่
          </Link>
        </div>
      </form>

      <div className="my-8 flex items-center gap-3 text-sm text-slate-400">
        <span className="h-px flex-1 bg-slate-200" />
        สำหรับช่าง
        <span className="h-px flex-1 bg-slate-200" />
      </div>
      <Button variant="line" className="w-full" loading={busy === 'line'} onClick={lineLogin}>
        เข้าสู่ระบบด้วย LINE
      </Button>
    </AuthShell>
  );
}
