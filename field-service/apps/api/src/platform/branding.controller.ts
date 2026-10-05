import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import sharp from 'sharp';
import { RequestId } from '../auth/session.guard.js';
import { apiError, Validation } from '../shared/api-error.js';
import { PlatformDatabaseService } from './platform-database.service.js';
import { Account, Permission, PlatformGuard, type PlatformAccount } from './platform.guard.js';

export interface Branding { version: number; logo: boolean; favicon: boolean; favicon_custom: boolean; updated_at: string | null }
const none: Branding = { version: 0, logo: false, favicon: false, favicon_custom: false, updated_at: null };
const maxInputBytes = 5 * 1024 * 1024;
const formats = ['png', 'jpeg', 'webp'];

export class InvalidBrandImageError extends Error {}

/** Re-encodes an uploaded image to PNG. Only PNG/JPEG/WebP are read (no SVG: it can carry script),
 * metadata is dropped, and the output size is fixed, so what is stored and served is always a
 * small, plain image whatever was uploaded. */
async function encode(input: Buffer, size: number, square: boolean): Promise<Buffer> {
  if (input.length < 1 || input.length > maxInputBytes) throw new InvalidBrandImageError('IMAGE_TOO_LARGE');
  let format: string | undefined;
  try { format = (await sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata()).format; }
  catch { throw new InvalidBrandImageError('IMAGE_UNREADABLE'); }
  if (!format || !formats.includes(format)) throw new InvalidBrandImageError('IMAGE_TYPE_NOT_ALLOWED');
  try {
    return await sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate()
      .resize(square ? { width: size, height: size, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }
        : { width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 }).toBuffer();
  } catch { throw new InvalidBrandImageError('IMAGE_UNREADABLE'); }
}
export const encodeLogo = (input: Buffer) => encode(input, 512, false);
export const encodeFavicon = (input: Buffer) => encode(input, 64, true);

interface ImageResponse { setHeader: (n: string, v: string) => void; status: (code: number) => ImageResponse; end: (b?: Buffer) => void }

/** Public brand: summary and images for sign-in pages, the join page, the app and browser tabs. */
@Controller('branding')
export class BrandingController {
  constructor(private readonly database: PlatformDatabaseService) {}

  @Get()
  async summary(@Res({ passthrough: true }) response: ImageResponse): Promise<Branding> {
    response.setHeader('Cache-Control', 'public, max-age=60');
    if (!this.database.configured) return none;
    try { return await this.database.run(async c => (await c.query('SELECT padmin.branding() AS v')).rows[0].v); }
    catch { return none; }
  }

  @Get('logo.png')
  logo(@Query('v') v: string | undefined, @Res() response: ImageResponse) { return this.image('logo', v, response); }

  @Get('favicon.png')
  favicon(@Query('v') v: string | undefined, @Res() response: ImageResponse) { return this.image('favicon', v, response); }

  /** `?v=<version>` URLs never change content, so they are cached for a long time; plain URLs briefly. */
  private async image(kind: 'logo' | 'favicon', v: string | undefined, response: ImageResponse) {
    if (!this.database.configured) throw apiError(404, 'RESOURCE_NOT_FOUND');
    const row = await this.database.run(async c => (await c.query('SELECT content, version FROM padmin.branding_image($1)', [kind])).rows[0]);
    if (!row) throw apiError(404, 'RESOURCE_NOT_FOUND');
    response.setHeader('Content-Type', 'image/png');
    response.setHeader('Cache-Control', v === String(row.version) ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
    response.setHeader('Content-Security-Policy', "default-src 'none'");
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.end(row.content);
  }
}

/** Changing the brand: super admin only (permission branding.manage). */
@Controller('platform/branding') @UseGuards(PlatformGuard)
export class BrandingSettingsController {
  constructor(private readonly database: PlatformDatabaseService) {}

  // Declared before ':kind' so that '/reset' is not taken as an image kind.
  @Post('reset') @HttpCode(200) @Permission('branding.manage')
  async reset(@Account() a: PlatformAccount, @RequestId() requestId: string, @Body() body: Record<string, unknown> = {}) {
    const check = new Validation();
    if (body.kind !== 'logo' && body.kind !== 'favicon') check.fail('kind', 'field.required');
    const expected = typeof body.version === 'number' && Number.isSafeInteger(body.version) && body.version >= 0 ? body.version : (check.fail('version', 'field.required'), 0);
    check.done();
    let favicon: Buffer | null = null;
    if (body.kind === 'favicon') {
      // Back to the favicon made from the current logo.
      const logo = await this.database.run(async c => (await c.query('SELECT content FROM padmin.branding_image($1)', ['logo'])).rows[0]?.content as Buffer | undefined);
      if (logo) favicon = await encodeFavicon(logo);
    }
    return this.save(a, requestId, `reset_${body.kind}`, null, favicon, expected);
  }

  /** Raw image body (image/png, image/jpeg or image/webp). `?version=` is the version last read. */
  @Post(':kind') @HttpCode(200) @Permission('branding.manage')
  async upload(@Account() a: PlatformAccount, @RequestId() requestId: string, @Param('kind') kind: string,
    @Query('version') version: string | undefined, @Req() request: { body: unknown }) {
    if (kind !== 'logo' && kind !== 'favicon') throw apiError(404, 'RESOURCE_NOT_FOUND');
    const expected = this.version(version);
    if (!Buffer.isBuffer(request.body)) throw apiError(400, 'VALIDATION_ERROR', { field_errors: { image: 'field.image' } });
    let logo: Buffer | null = null, favicon: Buffer;
    try {
      if (kind === 'logo') { logo = await encodeLogo(request.body); favicon = await encodeFavicon(logo); }
      else favicon = await encodeFavicon(request.body);
    } catch (e) {
      if (e instanceof InvalidBrandImageError) throw apiError(400, 'VALIDATION_ERROR', { field_errors: { image: 'field.image' } });
      throw e;
    }
    return this.save(a, requestId, kind, logo, favicon, expected);
  }

  private version(value: string | undefined) {
    const n = Number(value);
    if (value === undefined || !Number.isSafeInteger(n) || n < 0) throw apiError(400, 'VALIDATION_ERROR', { field_errors: { version: 'field.required' } });
    return n;
  }

  private async save(a: PlatformAccount, requestId: string, action: string, logo: Buffer | null, favicon: Buffer | null, version: number): Promise<Branding> {
    const result = await this.database.run(async c => (await c.query('SELECT padmin.save_branding($1,$2,$3,$4,$5,$6) AS r',
      [a.accountId, action, logo, favicon, version, requestId])).rows[0].r);
    if (result !== 'ok') throw apiError(409, 'VERSION_CONFLICT');
    return this.database.run(async c => (await c.query('SELECT padmin.branding() AS v')).rows[0].v);
  }
}
