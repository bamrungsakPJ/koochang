import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api, type Media } from './api';

const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
  const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
});

export interface Picked { uri: string; mimeType: string; }
export class CameraDeniedError extends Error {}

/** Opens the camera or the photo library. Returns null when the user cancels. The phone
 * compresses to JPEG; the server still re-encodes, strips metadata/GPS and resizes. */
export async function pickPhoto(source: 'camera' | 'library'): Promise<Picked | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, exif: false, allowsEditing: false };
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new CameraDeniedError();
  }
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const mimeType = asset.mimeType && ['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType) ? asset.mimeType : 'image/jpeg';
  return { uri: asset.uri, mimeType };
}

/** The picked image's bytes. Native reads the file directly (fetch(file://).blob() is unreliable
 * on Android); the web build reads its blob URL. */
export async function readPicked(picked: Picked): Promise<ArrayBuffer> {
  return Platform.OS === 'web' ? await (await fetch(picked.uri)).arrayBuffer() : await new File(picked.uri).arrayBuffer();
}

/** Reserve storage, send the bytes, get the processed file back. One request key per photo so a
 * retried upload never counts twice. */
export async function uploadPhoto(organizationId: string, picked: Picked, purpose: 'nameplate' | 'equipment' | 'service' | 'other', requestKey = uuid()): Promise<Media> {
  const data = await readPicked(picked);
  const media = await api.createMedia(organizationId, { request_key: requestKey, mime_type: picked.mimeType, byte_size: data.byteLength, purpose });
  return api.uploadMedia(organizationId, media.id, data, picked.mimeType);
}

/** Photos waiting for signal live in the app's own folder: the picker's copy sits in the cache,
 * which the system may clear before the photo is sent. */
const keptFolder = 'pending-photos';
export async function keepPhoto(picked: Picked, key: string): Promise<Picked> {
  if (Platform.OS === 'web') return picked;
  try {
    const dir = new Directory(Paths.document, keptFolder);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const target = new File(dir, `${key.replace(/[^a-zA-Z0-9-]/g, '')}.${picked.mimeType === 'image/png' ? 'png' : picked.mimeType === 'image/webp' ? 'webp' : 'jpg'}`);
    if (!target.exists) await new File(picked.uri).copy(target);
    return { uri: target.uri, mimeType: picked.mimeType };
  } catch { return picked; }
}
/** Deletes a kept photo once the server has it (only files in our own folder). */
export function dropKeptPhoto(uri: string) {
  if (Platform.OS === 'web' || !uri.includes(`/${keptFolder}/`)) return;
  try { const f = new File(uri); if (f.exists) f.delete(); } catch { /* removed already */ }
}

export { uuid };
