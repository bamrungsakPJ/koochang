import sharp from 'sharp';
import { createHash } from 'node:crypto';

export interface ProcessedImage { image: Buffer; thumbnail: Buffer; width: number; height: number; checksum: string; }
export class InvalidImageError extends Error {}

const accepted = new Set(['jpeg', 'png', 'webp']);

/** Decodes the upload to prove it is an image, applies the EXIF orientation, drops all metadata
 * (including GPS) by re-encoding, keeps nameplates readable (up to 2560 px) and stays under the
 * stored-size limit. Also makes a 400 px thumbnail. */
export async function processImage(input: Buffer, maxStoredBytes: number): Promise<ProcessedImage> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try { meta = await sharp(input, { failOn: 'error' }).metadata(); } catch { throw new InvalidImageError('IMAGE_UNREADABLE'); }
  if (!meta.format || !accepted.has(meta.format)) throw new InvalidImageError('IMAGE_TYPE_NOT_ALLOWED');
  if ((meta.width ?? 0) * (meta.height ?? 0) > 60_000_000) throw new InvalidImageError('IMAGE_TOO_LARGE');

  const base = () => sharp(input, { failOn: 'error' }).rotate().resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true });
  let image: Buffer | undefined;
  for (const quality of [82, 72, 60]) {
    image = await base().jpeg({ quality, mozjpeg: true }).toBuffer();
    if (image.length <= maxStoredBytes) break;
  }
  if (!image || image.length > maxStoredBytes) throw new InvalidImageError('IMAGE_TOO_LARGE');
  const { width = 0, height = 0 } = await sharp(image).metadata();
  const thumbnail = await sharp(image).resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
  return { image, thumbnail, width, height, checksum: createHash('sha256').update(image).digest('hex') };
}
