import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaKind, Role } from '@serviceflow/shared';
import type { Response } from 'express';
import { Public, Roles, TenantAuth, TenantAuthContext } from '../../common/auth/auth-context';
import { MAX_UPLOAD_BYTES, MediaService } from './media.service';

const ALL_ROLES = [Role.OWNER, Role.ADMIN, Role.DISPATCHER, Role.TECHNICIAN];
const KINDS = new Set<string>(Object.values(MediaKind));

@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Roles(...ALL_ROLES)
  @Post('media')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(
    @TenantAuth() auth: TenantAuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('kind') kind: string | undefined,
  ) {
    if (!file) throw new BadRequestException('ไม่พบไฟล์');
    const k = kind ?? MediaKind.ASSET;
    if (!KINDS.has(k)) throw new BadRequestException('ประเภทรูปไม่ถูกต้อง');
    return this.media.upload(auth, k as MediaKind, file.buffer);
  }

  @Public()
  @Get('public/media/:id')
  async serve(
    @Param('id') id: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    const obj = await this.media.openSigned(id, exp ?? '', sig ?? '');
    res.set({
      'content-type': obj.mime,
      'content-length': String(obj.size),
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    });
    obj.stream.pipe(res);
  }
}
