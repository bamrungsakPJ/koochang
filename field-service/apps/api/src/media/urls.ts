import type { MediaSettings } from '../config.js';
import { signKey } from './signed-url.js';

export interface UrlRequest { protocol: string; headers: Record<string, string | undefined>; }

/** Absolute base for signed file links, from the host the client used (works for LAN phones). */
export function filesBase(request: UrlRequest): string {
  return `${request.headers['x-forwarded-proto'] ?? request.protocol}://${request.headers['x-forwarded-host'] ?? request.headers.host}/v1/files`;
}

/** Short-lived download link for a stored key, or null when files are not configured. */
export function signedFileUrl(settings: MediaSettings, request: UrlRequest, key: string | null): string | null {
  if (!key || !settings.urlSecret) return null;
  return `${filesBase(request)}/${signKey(settings.urlSecret, key, settings.urlTtlSeconds).token}`;
}
