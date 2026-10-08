import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

/** Last good copy of what the field needs without signal: the user and shops, jobs, customers,
 * places and equipment. Read-only: the server stays the source of truth, every change still goes
 * to it. Kept in the app's private folder, deleted on sign-out, ignored after 14 days. Not on web. */
const maxAgeMs = 14 * 86_400_000;
const folder = 'offline-cache';

/** GET paths worth keeping. Searches are left out: a typed search only makes sense live. */
export function cacheable(path: string): boolean {
  if (path === '/me') return true;
  const m = /^\/organizations\/[^/]+\/(.+)$/.exec(path);
  if (!m) return false;
  const rest = m[1]!;
  if (rest.startsWith('customers?')) return /^customers\?q=&offset=0&limit=\d+$/.test(rest);
  return /^(jobs(\?.*)?|jobs\/[^/?]+|customers\/[^/?]+|locations\/[^/]+\/equipment|equipment\/[^/?]+(\/history)?|subscription|members|maintenance\?days=\d+)$/.test(rest);
}

/** FNV-1a: short stable file names for long paths. */
function name(path: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) { h ^= path.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(16).padStart(8, '0')}-${path.length}.json`;
}
function dir() {
  const d = new Directory(Paths.document, folder);
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

export function writeCache(path: string, value: unknown) {
  if (Platform.OS === 'web') return;
  try { new File(dir(), name(path)).write(JSON.stringify({ path, savedAt: Date.now(), value })); } catch { /* only the offline copy is missing */ }
}

export async function readCache<T>(path: string): Promise<{ value: T; savedAt: number } | null> {
  if (Platform.OS === 'web') return null;
  try {
    const f = new File(dir(), name(path));
    if (!f.exists) return null;
    const saved = JSON.parse(await f.text()) as { path: string; savedAt: number; value: T };
    if (saved.path !== path || Date.now() - saved.savedAt > maxAgeMs) return null;
    return { value: saved.value, savedAt: saved.savedAt };
  } catch { return null; }
}

export function clearCache() {
  if (Platform.OS === 'web') return;
  try { const d = new Directory(Paths.document, folder); if (d.exists) d.delete(); } catch { /* nothing kept */ }
}
