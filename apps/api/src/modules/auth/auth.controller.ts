import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import {
  lineLoginSchema,
  loginSchema,
  otpRequestSchema,
  otpVerifySchema,
  passwordResetSchema,
  signupSchema,
  switchTenantSchema,
} from '@serviceflow/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthContext, CurrentAuth, Public } from '../../common/auth/auth-context';
import { SessionCookie } from '../../common/auth/session-cookie';
import { clientIp } from '../../common/rate-limiter';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly otp: OtpService,
    private readonly cookie: SessionCookie,
  ) {}

  @Public()
  @Post('otp/request')
  @HttpCode(204)
  async requestOtp(@Body(new ZodPipe(otpRequestSchema)) body: z.output<typeof otpRequestSchema>, @Req() req: Request) {
    await this.otp.request(body.phone, body.purpose, clientIp(req));
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@Body(new ZodPipe(otpVerifySchema)) body: z.output<typeof otpVerifySchema>) {
    return { verificationToken: await this.otp.verify(body.phone, body.purpose, body.code) };
  }

  @Public()
  @Post('signup')
  async signup(
    @Body(new ZodPipe(signupSchema)) body: z.output<typeof signupSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.cookie.respond(res, await this.auth.signup(body));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: z.output<typeof loginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.cookie.respond(res, await this.auth.login(body.phone, body.password, clientIp(req)));
  }

  @Public()
  @Post('line')
  @HttpCode(200)
  async lineLogin(
    @Body(new ZodPipe(lineLoginSchema)) body: z.output<typeof lineLoginSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.cookie.respond(res, await this.auth.lineLogin(body.lineIdToken));
  }

  @Public()
  @Post('password/reset')
  @HttpCode(200)
  async resetPassword(
    @Body(new ZodPipe(passwordResetSchema)) body: z.output<typeof passwordResetSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.cookie.respond(res, await this.auth.resetPassword(body.verificationToken, body.password));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = this.cookie.read(req);
    if (!token) throw new UnauthorizedException();
    try {
      return this.cookie.respond(res, await this.auth.refresh(token));
    } catch (err) {
      this.cookie.clear(res);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(this.cookie.read(req));
    this.cookie.clear(res);
  }

  @Post('switch-tenant')
  @HttpCode(200)
  async switchTenant(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(switchTenantSchema)) body: z.output<typeof switchTenantSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.switchTenant(auth.accountId, body.tenantId);
    await this.auth.logout(this.cookie.read(req));
    return this.cookie.respond(res, session);
  }

  @Get('me')
  async me(@CurrentAuth() auth: AuthContext) {
    return {
      ...(await this.auth.me(auth.accountId)),
      activeTenantId: auth.membership?.tenantPublicId ?? null,
      role: auth.membership?.role ?? null,
    };
  }
}
