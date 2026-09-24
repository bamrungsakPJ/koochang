import { FormEvent, useEffect, useState } from 'react';
import type { OtpPurpose } from '@serviceflow/shared';
import { api } from '../api/client';
import { Button, ErrorText, Field, Input, errorMessage } from './ui';

const RESEND_SECONDS = 60;

/** Phone → SMS code → verification token. Used by signup and password reset. */
export function OtpStep({ purpose, onVerified }: { purpose: OtpPurpose; onVerified: (token: string) => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/auth/otp/request', { method: 'POST', body: { phone, purpose } });
      setSent(true);
      setCode('');
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api<{ verificationToken: string }>('/auth/otp/verify', {
        method: 'POST',
        body: { phone, purpose, code },
      });
      onVerified(res.verificationToken);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!sent) {
    return (
      <form onSubmit={requestCode} className="space-y-4">
        <Field label="เบอร์มือถือ" hint="ระบบจะส่งรหัส 6 หลักทาง SMS">
          <Input
            inputMode="tel"
            autoComplete="tel"
            placeholder="081-234-5678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoFocus
            required
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" className="w-full" loading={busy}>
          ขอรหัสยืนยัน
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      <p className="text-slate-600">
        ส่งรหัสไปที่ <span className="font-medium text-slate-900">{phone}</span> แล้ว{' '}
        <button type="button" className="text-brand-700 hover:underline" onClick={() => setSent(false)}>
          เปลี่ยนเบอร์
        </button>
      </p>
      <Field label="รหัสยืนยัน">
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="••••••"
          className="text-center text-2xl tracking-[0.5em]"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          autoFocus
          required
        />
      </Field>
      <ErrorText>{error}</ErrorText>
      <Button type="submit" className="w-full" loading={busy} disabled={code.length !== 6}>
        ยืนยัน
      </Button>
      <Button type="button" variant="ghost" className="w-full" disabled={cooldown > 0 || busy} onClick={() => requestCode()}>
        {cooldown > 0 ? `ส่งรหัสใหม่ได้ใน ${cooldown} วินาที` : 'ส่งรหัสใหม่'}
      </Button>
    </form>
  );
}
