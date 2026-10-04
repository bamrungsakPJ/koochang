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

/** Reserve storage, send the bytes, get the processed file back. One request key per photo so a
 * retried upload never counts twice. */
export async function uploadPhoto(organizationId: string, picked: Picked, purpose: 'nameplate' | 'equipment' | 'service' | 'other'): Promise<Media> {
  const data = await (await fetch(picked.uri)).blob();
  const media = await api.createMedia(organizationId, { request_key: uuid(), mime_type: picked.mimeType, byte_size: data.size, purpose });
  return api.uploadMedia(organizationId, media.id, data, picked.mimeType);
}

export { uuid };
