import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { api, applySession, onSessionChange, refreshSession, Session, TenantSummary } from '../api/client';

interface SessionState {
  loading: boolean;
  session: Session | null;
  activeTenant: TenantSummary | null;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const off = onSessionChange(setSession);
    void refreshSession().finally(() => setLoading(false));
    return off;
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      loading,
      session,
      activeTenant: session?.tenants.find((t) => t.id === session.activeTenantId) ?? null,
      logout: async () => {
        await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
        applySession(null);
      },
    }),
    [loading, session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}

/** Where a signed-in user belongs. */
export function homePath(session: Session | null): string {
  if (!session) return '/login';
  const active = session.tenants.find((t) => t.id === session.activeTenantId);
  if (!active) return session.tenants.length ? '/select-shop' : '/no-shop';
  return active.role === 'TECHNICIAN' ? '/tech' : '/admin';
}
