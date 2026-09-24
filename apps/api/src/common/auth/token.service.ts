import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { OtpPurpose } from '@serviceflow/shared';
import jwt from 'jsonwebtoken';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { randomToken, sha256 } from '../ids';
import { PrismaService } from '../prisma/prisma.service';

const ISSUER = 'serviceflow';
const ACCESS_TTL_SECONDS = 15 * 60;
const PHONE_VERIFICATION_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AccessClaims {
  /** account publicId */
  sub: string;
  /** tenant publicId, null when no shop is selected */
  tid: string | null;
}

@Injectable()
export class TokenService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  signAccess(claims: AccessClaims): string {
    return jwt.sign({ tid: claims.tid }, this.config.JWT_SECRET, {
      algorithm: 'HS256',
      subject: claims.sub,
      issuer: ISSUER,
      audience: 'access',
      expiresIn: ACCESS_TTL_SECONDS,
    });
  }

  verifyAccess(token: string): AccessClaims {
    try {
      const p = jwt.verify(token, this.config.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: 'access',
      }) as jwt.JwtPayload;
      if (typeof p.sub !== 'string') throw new Error('no sub');
      return { sub: p.sub, tid: typeof p.tid === 'string' ? p.tid : null };
    } catch {
      throw new UnauthorizedException();
    }
  }

  /** Proof that the caller just passed an OTP for this phone + purpose. */
  signPhoneVerification(phoneE164: string, purpose: OtpPurpose): string {
    return jwt.sign({ phone: phoneE164, purpose }, this.config.JWT_SECRET, {
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: 'phone-verification',
      expiresIn: PHONE_VERIFICATION_TTL_SECONDS,
    });
  }

  verifyPhoneVerification(token: string, purpose: OtpPurpose): string {
    try {
      const p = jwt.verify(token, this.config.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: 'phone-verification',
      }) as jwt.JwtPayload;
      if (p.purpose !== purpose || typeof p.phone !== 'string') throw new Error('bad claims');
      return p.phone;
    } catch {
      throw new UnauthorizedException('การยืนยันเบอร์หมดอายุ กรุณาขอรหัสใหม่');
    }
  }

  async issueRefresh(accountId: number, tenantPublicId: string | null): Promise<string> {
    const token = randomToken();
    await this.prisma.refreshToken.create({
      data: {
        accountId,
        tenantPublicId,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return token;
  }

  /**
   * Single-use rotation. Presenting an already-used token means it was stolen or replayed,
   * so every session of that account is revoked.
   */
  async consumeRefresh(token: string): Promise<{ accountId: number; tenantPublicId: string | null }> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row) throw new UnauthorizedException();

    if (row.revokedAt) {
      await this.revokeAllForAccount(row.accountId);
      throw new UnauthorizedException();
    }
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count !== 1) {
      await this.revokeAllForAccount(row.accountId);
      throw new UnauthorizedException();
    }
    if (row.expiresAt < new Date()) throw new UnauthorizedException();
    return { accountId: row.accountId, tenantPublicId: row.tenantPublicId };
  }

  async revokeRefresh(token: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForAccount(accountId: number): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { accountId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
