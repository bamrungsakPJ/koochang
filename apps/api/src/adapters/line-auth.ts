import { Injectable, UnauthorizedException } from '@nestjs/common';

export const LINE_ID_TOKEN_VERIFIER = Symbol('LINE_ID_TOKEN_VERIFIER');

export interface LineUser {
  /** LINE user IDs are per provider, so identities are keyed by channel + user. */
  channelId: string;
  userId: string;
  name?: string;
}

export interface LineIdTokenVerifier {
  verify(idToken: string): Promise<LineUser>;
}

/** Verifies a LIFF / LINE Login ID token with LINE's verify endpoint. */
@Injectable()
export class LineApiIdTokenVerifier implements LineIdTokenVerifier {
  constructor(private readonly channelId: string) {}

  async verify(idToken: string): Promise<LineUser> {
    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: this.channelId }),
    });
    if (!res.ok) throw new UnauthorizedException('ยืนยันตัวตน LINE ไม่สำเร็จ');
    const body = (await res.json()) as { sub?: string; name?: string };
    if (!body.sub) throw new UnauthorizedException('ยืนยันตัวตน LINE ไม่สำเร็จ');
    return { channelId: this.channelId, userId: body.sub, name: body.name };
  }
}

/**
 * Dev/test only (rejected in production by config): accepts "dev:<lineUserId>:<name>"
 * so the flow can be exercised without a LINE channel.
 */
@Injectable()
export class DevLineIdTokenVerifier implements LineIdTokenVerifier {
  async verify(idToken: string): Promise<LineUser> {
    const [prefix, userId, ...name] = idToken.split(':');
    if (prefix !== 'dev' || !userId) throw new UnauthorizedException('ยืนยันตัวตน LINE ไม่สำเร็จ');
    return { channelId: 'dev', userId, name: name.join(':') || undefined };
  }
}
