import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

/** Unsent form entries kept on the device, so closing the app or losing signal never loses a
 * technician's work. Values are plain JSON (no tokens). Drafts older than 7 days are ignored. */
const maxAgeMs = 7 * 86_400_000;
const safeName = (key: string) => key.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';

function file(key: string): File {
  const dir = new Directory(Paths.document, 'drafts');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return new File(dir, safeName(key));
}

export async function loadDraft<T>(key: string): Promise<T | null> {
  try {
    const text = Platform.OS === 'web' ? localStorage.getItem(`draft.${key}`) : await (() => { const f = file(key); return f.exists ? f.text() : Promise.resolve(null); })();
    if (!text) return null;
    const saved = JSON.parse(text) as { savedAt: number; value: T };
    if (!saved || Date.now() - saved.savedAt > maxAgeMs) { await clearDraft(key); return null; }
    return saved.value;
  } catch { return null; }
}

export async function saveDraft<T>(key: string, value: T): Promise<void> {
  try {
    const text = JSON.stringify({ key, savedAt: Date.now(), value });
    if (Platform.OS === 'web') localStorage.setItem(`draft.${key}`, text);
    else file(key).write(text);
  } catch { /* the form still works; only the offline copy is missing */ }
}

export async function clearDraft(key: string): Promise<void> {
  try {
    if (Platform.OS === 'web') localStorage.removeItem(`draft.${key}`);
    else { const f = file(key); if (f.exists) f.delete(); }
  } catch { /* nothing to clear */ }
}

/** Unsent drafts whose key starts with the prefix, newest first (e.g. one shop's service records). */
export async function listDrafts<T>(prefix: string): Promise<{ key: string; savedAt: number; value: T }[]> {
  const found: { key: string; savedAt: number; value: T }[] = [];
  const take = (text: string | null) => {
    try {
      const saved = text ? JSON.parse(text) as { key?: string; savedAt: number; value: T } : null;
      if (saved?.key?.startsWith(prefix) && Date.now() - saved.savedAt <= maxAgeMs) found.push({ key: saved.key, savedAt: saved.savedAt, value: saved.value });
    } catch { /* unreadable copy */ }
  };
  try {
    if (Platform.OS === 'web') { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('draft.')) take(localStorage.getItem(k)); } }
    else {
      const dir = new Directory(Paths.document, 'drafts');
      if (dir.exists) for (const entry of dir.list()) if (entry instanceof File) take(await entry.text());
    }
  } catch { /* nothing listed */ }
  return found.sort((a, b) => b.savedAt - a.savedAt);
}
