import { BadRequestException, Inject, Injectable, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { MediaKind } from '@serviceflow/shared';
import { OBJECT_STORAGE, ObjectStorage } from '../../adapters/storage';
import { TenantAuthContext } from '../../common/auth/auth-context';
import { hmacSha256, newPublicId, safeEqualHex } from '../../common/ids';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { TenantDb } from '../../common/prisma/tenant-scope';
import { APP_CONFIG, AppConfig } from '../../config/config';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const URL_TTL_SECONDS = 6 * 60 * 60;

type TenantTx = Parameters<Parameters<TenantDb['$transaction']>[0]>[0];

/** Sniff the real type from magic bytes; the client-declared MIME is not trusted (req §37). */
export function detectImageType(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(brand)) return { mime: 'image/heic', ext: 'heic' };
  }
  return null;
}

@Injectable()
export class MediaService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly prisma: PrismaService,
  ) {}

  async upload(auth: TenantAuthContext, kind: MediaKind, data: Buffer) {
    if (data.length === 0) throw new BadRequestException('ไฟล์ว่าง');
    if (data.length > MAX_UPLOAD_BYTES) throw new BadRequestException('ไฟล์ใหญ่เกิน 10 MB');
    const type = detectImageType(data);
    if (!type) throw new UnsupportedMediaTypeException('รองรับเฉพาะรูปภาพ JPEG, PNG, WebP, HEIC');

    const publicId = newPublicId();
    const now = new Date();
    const key = `${auth.membership.tenantPublicId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${publicId}.${type.ext}`;
    await this.storage.put(key, data, type.mime);

    const media = await this.prisma.forTenant(auth.membership.tenantId).media.create({
      data: {
        publicId,
        tenantId: auth.membership.tenantId,
        kind,
        storageKey: key,
        mime: type.mime,
        size: data.length,
        createdByMembershipId: auth.membership.id,
      },
    });
    return { id: media.publicId, kind: media.kind, mime: media.mime, size: media.size, url: this.signedUrl(media.publicId) };
  }

  /**
   * Links uploaded media to what they belong to. Only unattached media of this tenant
   * (or media already attached to the same owner) can be used. Returns internal ids.
   */
  async attach(tx: TenantTx, publicIds: string[], ownerType: string, ownerId: number): Promise<number[]> {
    const unique = [...new Set(publicIds)];
    if (unique.length === 0) return [];
    const rows = await tx.media.findMany({
      where: {
        publicId: { in: unique },
        deletedAt: null,
        OR: [{ ownerType: null }, { ownerType, ownerId }],
      },
      select: { id: true },
    });
    if (rows.length !== unique.length) throw new BadRequestException('ไม่พบรูปที่อัปโหลด');
    await tx.media.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { ownerType, ownerId } });
    return rows.map((r) => r.id);
  }

  /** <img src> can't send a bearer token, so media are served through short-lived signed URLs. */
  signedUrl(publicId: string): string {
    const exp = Math.floor(Date.now() / 1000) + URL_TTL_SECONDS;
    return `/api/v1/public/media/${publicId}?exp=${exp}&sig=${this.sign(publicId, exp)}`;
  }

  async openSigned(publicId: string, exp: string, sig: string) {
    const expNum = Number(exp);
    const valid =
      Number.isInteger(expNum) &&
      expNum > Date.now() / 1000 &&
      /^[0-9a-f]{64}$/.test(sig) &&
      safeEqualHex(sig, this.sign(publicId, expNum));
    if (!valid) throw new NotFoundException();

    const media = await this.prisma.media.findUnique({ where: { publicId } });
    if (!media || media.deletedAt) throw new NotFoundException();
    const obj = await this.storage.get(media.storageKey);
    if (!obj) throw new NotFoundException();
    return { ...obj, mime: media.mime };
  }

  private sign(publicId: string, exp: number): string {
    return hmacSha256(this.config.JWT_SECRET, `media:${publicId}:${exp}`);
  }
}
