import type { Role } from '@serviceflow/shared';

export interface TenantSummary {
  id: string;
  name: string;
  role: Role;
}

export interface Session {
  accessToken: string;
  account: { id: string; displayName: string };
  tenants: TenantSummary[];
  activeTenantId: string | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Listener = (session: Session | null) => void;

// Access token lives in memory only; the refresh token is an httpOnly cookie the browser sends itself.
let accessToken: string | null = null;
let refreshing: Promise<Session | null> | null = null;
const listeners = new Set<Listener>();

export function onSessionChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function applySession(session: Session | null): void {
  accessToken = session?.accessToken ?? null;
  listeners.forEach((l) => l(session));
}

async function send(path: string, method: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  return fetch(`/api/v1${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
}

async function toError(res: Response): Promise<ApiError> {
  let message = 'เกิดข้อผิดพลาด กรุณาลองใหม่';
  try {
    const data = (await res.json()) as { message?: unknown; issues?: { message: string }[] };
    if (data.issues?.length) message = data.issues[0].message;
    else if (typeof data.message === 'string') message = data.message;
  } catch {
    // Non-JSON error body: keep the generic message.
  }
  return new ApiError(message, res.status);
}

/** Restores or renews the session from the refresh cookie. Concurrent callers share one request. */
export function refreshSession(): Promise<Session | null> {
  refreshing ??= (async () => {
    try {
      const res = await send('/auth/refresh', 'POST');
      const session = res.ok ? ((await res.json()) as Session) : null;
      applySession(session);
      return session;
    } catch {
      applySession(null);
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
  let res = await send(path, method, options.body);

  // Access tokens last 15 minutes: renew once and retry.
  if (res.status === 401 && accessToken && !path.startsWith('/auth/')) {
    if (await refreshSession()) res = await send(path, method, options.body);
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** For endpoints that return a session (login, signup, invite accept…). */
export async function apiSession(path: string, body?: unknown): Promise<Session> {
  const session = await api<Session>(path, { method: 'POST', body });
  applySession(session);
  return session;
}
