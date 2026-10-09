import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';

export class GalleryDeniedError extends Error {}

/** Saves a PNG data URI (e.g. the PromptPay QR) to the phone's photos, so the owner can open it
 * from a banking app. Asks only for add-only access to photos; nothing is read from the gallery. */
export async function savePngToGallery(dataUri: string, name: string): Promise<void> {
  const base64 = dataUri.replace(/^data:image\/png;base64,/, '');
  const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
  if (!permission.granted) throw new GalleryDeniedError();
  const file = new File(Paths.cache, `${name.replace(/[^a-zA-Z0-9-]/g, '')}.png`);
  try {
    if (file.exists) file.delete();
    file.write(base64, { encoding: 'base64' });
    await MediaLibrary.saveToLibraryAsync(file.uri);
  } finally {
    try { if (file.exists) file.delete(); } catch { /* the cache copy goes with the cache */ }
  }
}
