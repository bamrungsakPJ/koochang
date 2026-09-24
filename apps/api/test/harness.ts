import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { SMS_SENDER, SmsSender } from '../src/adapters/sms';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { RateLimiter } from '../src/common/rate-limiter';
import { APP_CONFIG, loadConfig } from '../src/config/config';
import { assertTestDatabase } from './global-setup';

export const hasTestDb = Boolean(process.env.DATABASE_URL_TEST);

export class FakeSms implements SmsSender {
  sent: { phone: string; message: string }[] = [];
  failNext = false;

  async send(phone: string, message: string) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('provider down');
    }
    this.sent.push({ phone, message });
  }

  lastCode(phone: string): string {
    const msg = [...this.sent].reverse().find((s) => s.phone === phone);
    const code = msg?.message.match(/\d{6}/)?.[0];
    if (!code) throw new Error(`no OTP sent to ${phone}`);
    return code;
  }
}

export interface Harness {
  app: NestExpressApplication;
  prisma: PrismaService;
  sms: FakeSms;
  http: () => ReturnType<typeof request>;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const url = process.env.DATABASE_URL_TEST!;
  assertTestDatabase(url);
  const sms = new FakeSms();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: url,
        JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
        APP_URL: 'http://localhost:5173',
        LINE_AUTH_MODE: 'dev',
      }),
    )
    .overrideProvider(SMS_SENDER)
    .useValue(sms)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  const limiter = app.get(RateLimiter);

  return {
    app,
    prisma,
    sms,
    http: () => request(app.getHttpServer()),
    reset: async () => {
      sms.sent = [];
      sms.failNext = false;
      limiter.reset();
      // Children first (FKs are NO ACTION).
      await prisma.domainEvent.deleteMany();
      await prisma.invite.deleteMany();
      await prisma.refreshToken.deleteMany();
      await prisma.otpChallenge.deleteMany();
      await prisma.lineIdentity.deleteMany();
      await prisma.membership.deleteMany();
      await prisma.verifiedPhone.deleteMany();
      await prisma.account.deleteMany();
      await prisma.tenant.deleteMany();
    },
    close: () => app.close(),
  };
}

/** Full owner signup through the public API. Returns the access token and tenant id. */
export async function signupShop(h: Harness, phone: string, shopName: string) {
  await h.http().post('/api/v1/auth/otp/request').send({ phone, purpose: 'SIGNUP' }).expect(204);
  const e164 = `+66${phone.replace(/\D/g, '').slice(1)}`;
  const verify = await h
    .http()
    .post('/api/v1/auth/otp/verify')
    .send({ phone, purpose: 'SIGNUP', code: h.sms.lastCode(e164) })
    .expect(200);
  const signup = await h
    .http()
    .post('/api/v1/auth/signup')
    .send({
      verificationToken: verify.body.verificationToken,
      shopName,
      displayName: `Owner of ${shopName}`,
      password: 'correct-horse-1',
    })
    .expect(201);
  return {
    token: signup.body.accessToken as string,
    tenantId: signup.body.activeTenantId as string,
    cookies: signup.headers['set-cookie'] as unknown as string[],
  };
}

export async function inviteAndJoin(h: Harness, ownerToken: string, lineUserId: string, name: string) {
  const invite = await h
    .http()
    .post('/api/v1/invites')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ role: 'TECHNICIAN' })
    .expect(201);
  const token = (invite.body.url as string).split('/join/')[1];
  const joined = await h
    .http()
    .post(`/api/v1/public/invites/${token}/accept`)
    .send({ lineIdToken: `dev:${lineUserId}:${name}`, displayName: name, phone: '089-999-0000' })
    .expect(201);
  return { inviteId: invite.body.id as string, inviteToken: token, session: joined.body };
}
