/**
 * LINE identity for technicians. Production uses LIFF (`liff.getIDToken()`, milestone M3).
 * In dev the API accepts "dev:<lineUserId>:<name>", so the browser plays a fake LINE account.
 */
const mode = (import.meta.env.VITE_LINE_AUTH_MODE as string | undefined) ?? 'dev';

export const isDevLine = mode === 'dev';

const DEV_USER_KEY = 'sf_dev_line_user';

export function getDevLineUserId(): string {
  try {
    const existing = localStorage.getItem(DEV_USER_KEY);
    if (existing) return existing;
    const created = `U-dev-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEV_USER_KEY, created);
    return created;
  } catch {
    return 'U-dev-anonymous';
  }
}

export function setDevLineUserId(id: string): void {
  try {
    localStorage.setItem(DEV_USER_KEY, id);
  } catch {
    // Storage blocked: the id only lives for this page.
  }
}

export async function getLineIdToken(name = ''): Promise<string> {
  if (isDevLine) return `dev:${getDevLineUserId()}:${name}`;
  throw new Error('ยังไม่ได้ตั้งค่า LINE Login');
}

/** Opens LINE's share sheet so the owner can pick a chat (req: invite via personal LINE). */
export function lineShareUrl(text: string): string {
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
}
