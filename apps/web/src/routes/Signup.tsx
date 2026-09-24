import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { apiSession } from '../api/client';
import { OtpStep } from '../components/OtpStep';
import { AuthShell, Button, ErrorText, Field, Input, errorMessage } from '../components/ui';

export function Signup() {
  const navigate = useNavigate();
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [shopName, setShopName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await apiSession('/auth/signup', { verificationToken, shopName, displayName, password });
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="สมัครร้านใหม่"
      subtitle={verificationToken ? 'ขั้นสุดท้าย: ข้อมูลร้าน' : 'ยืนยันเบอร์มือถือของเจ้าของร้าน'}
    >
      {!verificationToken ? (
        <OtpStep purpose="SIGNUP" onVerified={setVerificationToken} />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="ชื่อร้าน">
            <Input value={shopName} onChange={(e) => setShopName(e.target.value)} autoFocus required />
          </Field>
          <Field label="ชื่อของคุณ">
            <Input autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </Field>
          <Field label="ตั้งรหัสผ่าน" hint="อย่างน้อย 8 ตัวอักษร">
            <Input
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" className="w-full" loading={busy}>
            เริ่มใช้งาน
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-slate-600">
        มีบัญชีแล้ว?{' '}
        <Link to="/login" className="font-medium text-brand-700 hover:underline">
          เข้าสู่ระบบ
        </Link>
      </p>
    </AuthShell>
  );
}
