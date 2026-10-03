import { Inject, Injectable } from '@nestjs/common';
import QRCode from 'qrcode';
import { AUTH_SETTINGS, type AuthSettings } from '../config.js';
import { apiError } from '../shared/api-error.js';
import { decrypt, encrypt, randomToken, sha256Hex } from '../shared/crypto.js';

export interface JoinLinkRow { id: string; status: 'active' | 'closed'; generation: number; token_ciphertext: string; version: number; updated_at: string; }

/** Join link tokens: the database keeps sha256(token) for lookup and an AES-GCM copy for the
 * owner to share again. The key lives in the environment, not in the database. Tokens are
 * never logged. */
@Injectable()
export class JoinLinksService {
  constructor(@Inject(AUTH_SETTINGS) private readonly settings: AuthSettings) {}

  issue(): { token: string; hash: string; ciphertext: string } {
    const key = this.key();
    const token = randomToken();
    return { token, hash: sha256Hex(token), ciphertext: encrypt(key, token) };
  }

  hash(token: string): string { return sha256Hex(token); }

  async present(row: JoinLinkRow) {
    const token = decrypt(this.key(), row.token_ciphertext);
    const url = `${this.settings.joinLinkBaseUrl}/${token}`;
    return {
      id: row.id, status: row.status, generation: row.generation, version: row.version, updated_at: row.updated_at,
      url, qr_png: await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 512 }),
    };
  }

  private key(): Buffer {
    if (!this.settings.joinLinkKey || !this.settings.joinLinkBaseUrl) throw apiError(503, 'TEMPORARILY_UNAVAILABLE');
    return this.settings.joinLinkKey;
  }
}
