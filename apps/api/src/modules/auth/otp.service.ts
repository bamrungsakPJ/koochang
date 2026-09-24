import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { OtpPurpose } from '@serviceflow/shared';
import { randomInt } from 'node:crypto';
import { SMS_SENDER, SmsSender } from '../../adapters/sms';
import { APP_CONFIG, AppConfig } from '../../config/config';
import { TokenService } from '../../common/auth/token.service';
import { hmacSha256, safeEqualHex } from '../../common/ids';
import { PrismaService } from '../../common/prisma/prisma.service';

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const PER_PHONE_COOLDOWN_MS = 60 * 1000;
const PER_PHONE_HOURLY = 5;
const PER_IP_HOURLY = 20;
const HOUR_MS = 60 * 60 * 1000;

/**
 * SMS OTP — only used for shop signup and password reset (docs/architecture.md D7).
 * Limits are counted from the otp_challenge table so they survive restarts: every SMS costs money.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async request(phoneE164: string, purpose: OtpPurpose, ip: string): Promise<void> {
    const registered = await this.prisma.verifiedPhone.findUnique({ where: { phoneE164 } });
    if (purpose === OtpPurpose.SIGNUP && registered) {
      throw new ConflictException('เบอร์นี้สมัครแล้ว กรุณาเข้าสู่ระบบ');
    }

    await this.enforceLimits(phoneE164, ip);

    // Reset for an unknown number: answer the same way but send nothing (no enumeration, no cost).
    if (purpose === OtpPurpose.RESET && !registered) return;

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.otpChallenge.create({
      data: {
        phoneE164,
        purpose,
        codeHash: this.hash(phoneE164, purpose, code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        requestIp: ip,
      },
    });
    await this.sms.send(phoneE164, `รหัสยืนยัน ServiceFlow: ${code} (หมดอายุใน 5 นาที)`);
  }

  /** Returns a short-lived phone-verification token. */
  async verify(phoneE164: string, purpose: OtpPurpose, code: string): Promise<string> {
    const invalid = () => new BadRequestException('รหัสไม่ถูกต้องหรือหมดอายุ');
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phoneE164, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw invalid();

    const counted = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, attempts: { lt: MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count !== 1) throw new BadRequestException('ใส่รหัสผิดหลายครั้ง กรุณาขอรหัสใหม่');

    if (!safeEqualHex(challenge.codeHash, this.hash(phoneE164, purpose, code))) throw invalid();

    const consumed = await this.prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw invalid();

    return this.tokens.signPhoneVerification(phoneE164, purpose);
  }

  private async enforceLimits(phoneE164: string, ip: string) {
    const now = Date.now();
    const tooMany = () =>
      new HttpException('ขอรหัสบ่อยเกินไป กรุณารอสักครู่', HttpStatus.TOO_MANY_REQUESTS);

    const [lastMinute, lastHourPhone, lastHourIp] = await Promise.all([
      this.prisma.otpChallenge.count({
        where: { phoneE164, createdAt: { gt: new Date(now - PER_PHONE_COOLDOWN_MS) } },
      }),
      this.prisma.otpChallenge.count({
        where: { phoneE164, createdAt: { gt: new Date(now - HOUR_MS) } },
      }),
      this.prisma.otpChallenge.count({
        where: { requestIp: ip, createdAt: { gt: new Date(now - HOUR_MS) } },
      }),
    ]);
    if (lastMinute > 0 || lastHourPhone >= PER_PHONE_HOURLY || lastHourIp >= PER_IP_HOURLY) {
      throw tooMany();
    }
  }

  private hash(phoneE164: string, purpose: OtpPurpose, code: string): string {
    return hmacSha256(this.config.JWT_SECRET, `${phoneE164}:${purpose}:${code}`);
  }
}
