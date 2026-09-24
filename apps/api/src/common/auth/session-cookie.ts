import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { REFRESH_TTL_MS } from './token.service';

const REFRESH_COOKIE = 'sf_rt';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** The refresh token lives only in an httpOnly cookie; response bodies never carry it. */
@Injectable()
export class SessionCookie {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  read(req: Request): string | undefined {
    return req.cookies?.[REFRESH_COOKIE] as string | undefined;
  }

  clear(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }

  /** Sets the cookie and returns the session without the refresh token. */
  respond<T extends { refreshToken: string }>(res: Response, session: T): Omit<T, 'refreshToken'> {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_TTL_MS,
    });
    const { refreshToken: _omit, ...body } = session;
    return body;
  }
}
