import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { apiSession } from '../api/client';
import { homePath } from '../auth/session';
import { OtpStep } from '../components/OtpStep';
import { AuthShell, Button, ErrorText, Field, Input, errorMessage } from '../components/ui';

export function ResetPassword() {
  const navigate = useNavigate();
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const session = await apiSession('/auth/password/reset', { verificationToken, password });
      navigate(homePath(session), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="ตั้งรหัสผ่านใหม่" subtitle="ยืนยันด้วยเบอร์มือถือที่ใช้สมัคร">
      {!verificationToken ? (
        <OtpStep purpose="RESET" onVerified={setVerificationToken} />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 8 ตัวอักษร">
            <Input
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" className="w-full" loading={busy}>
            บันทึกและเข้าสู่ระบบ
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="text-slate-600 hover:underline">
          กลับไปหน้าเข้าสู่ระบบ
        </Link>
      </p>
    </AuthShell>
  );
}
