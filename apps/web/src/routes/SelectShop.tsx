import { useState } from 'react';
import { useNavigate } from 'react-router';
import { apiSession } from '../api/client';
import { homePath, useSession } from '../auth/session';
import { AuthShell, Button, ErrorText, errorMessage, roleLabel } from '../components/ui';

export function SelectShop() {
  const { session, logout } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function choose(tenantId: string) {
    setError('');
    setBusy(tenantId);
    try {
      navigate(homePath(await apiSession('/auth/switch-tenant', { tenantId })), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AuthShell title="เลือกร้าน" subtitle={`สวัสดี ${session?.account.displayName ?? ''}`}>
      <div className="space-y-3">
        {session?.tenants.map((t) => (
          <button
            key={t.id}
            onClick={() => choose(t.id)}
            disabled={busy !== null}
            className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-left hover:border-brand-600 disabled:opacity-60"
          >
            <span className="font-medium">{t.name}</span>
            <span className="text-sm text-slate-500">{busy === t.id ? 'กำลังเปิด…' : roleLabel[t.role]}</span>
          </button>
        ))}
        <ErrorText>{error}</ErrorText>
        <Button variant="ghost" className="w-full" onClick={logout}>
          ออกจากระบบ
        </Button>
      </div>
    </AuthShell>
  );
}
