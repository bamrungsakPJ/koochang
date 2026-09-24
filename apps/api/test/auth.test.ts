import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, Harness, hasTestDb, signupShop } from './harness';

describe.skipIf(!hasTestDb)('auth: owner signup / login', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => h?.close());
  beforeEach(async () => h.reset());

  it('signs up a shop with SMS OTP and becomes its owner', async () => {
    const { token, tenantId } = await signupShop(h, '081-234-5678', 'ร้านแอร์ ABC');
    expect(tenantId).toMatch(/^[0-9A-Z]{26}$/);

    const me = await h.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body.role).toBe('OWNER');
    expect(me.body.tenants).toEqual([{ id: tenantId, name: 'ร้านแอร์ ABC', role: 'OWNER' }]);

    const events = await h.prisma.domainEvent.findMany();
    expect(events.map((e) => e.eventType)).toEqual(['TENANT_CREATED']);
  });

  it('refuses a second signup with the same phone', async () => {
    await signupShop(h, '0812345678', 'Shop 1');
    const res = await h
      .http()
      .post('/api/v1/auth/otp/request')
      .send({ phone: '+66812345678', purpose: 'SIGNUP' })
      .expect(409);
    expect(res.body.message).toContain('สมัครแล้ว');
  });

  it('never returns the refresh token in the body', async () => {
    const res = await signupShop(h, '0812345678', 'Shop');
    expect(res.cookies.join(';')).toMatch(/sf_rt=.+HttpOnly/i);
    const login = await h
      .http()
      .post('/api/v1/auth/login')
      .send({ phone: '0812345678', password: 'correct-horse-1' })
      .expect(200);
    expect(login.body.refreshToken).toBeUndefined();
  });

  it('logs in with phone + password in any typed format', async () => {
    await signupShop(h, '0812345678', 'Shop');
    await h.http().post('/api/v1/auth/login').send({ phone: '+66 81 234 5678', password: 'correct-horse-1' }).expect(200);
    const bad = await h.http().post('/api/v1/auth/login').send({ phone: '0812345678', password: 'nope' }).expect(401);
    const unknown = await h.http().post('/api/v1/auth/login').send({ phone: '0899999999', password: 'nope' }).expect(401);
    expect(bad.body.message).toBe(unknown.body.message);
  });

  it('locks an OTP after 5 wrong codes', async () => {
    await h.http().post('/api/v1/auth/otp/request').send({ phone: '0812345678', purpose: 'SIGNUP' }).expect(204);
    const right = h.sms.lastCode('+66812345678');
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await h.http().post('/api/v1/auth/otp/verify').send({ phone: '0812345678', purpose: 'SIGNUP', code: wrong }).expect(400);
    }
    await h.http().post('/api/v1/auth/otp/verify').send({ phone: '0812345678', purpose: 'SIGNUP', code: right }).expect(400);
  });

  it('rate-limits OTP requests per phone', async () => {
    await h.http().post('/api/v1/auth/otp/request').send({ phone: '0812345678', purpose: 'SIGNUP' }).expect(204);
    await h.http().post('/api/v1/auth/otp/request').send({ phone: '0812345678', purpose: 'SIGNUP' }).expect(429);
    expect(h.sms.sent).toHaveLength(1);
  });

  it('does not send a reset SMS for an unknown number but answers the same', async () => {
    await h.http().post('/api/v1/auth/otp/request').send({ phone: '0899999999', purpose: 'RESET' }).expect(204);
    expect(h.sms.sent).toHaveLength(0);
  });

  it('resets the password via OTP and kills old sessions', async () => {
    const { cookies } = await signupShop(h, '0812345678', 'Shop');
    await h.prisma.otpChallenge.deleteMany(); // skip the 60s cooldown from signup

    await h.http().post('/api/v1/auth/otp/request').send({ phone: '0812345678', purpose: 'RESET' }).expect(204);
    const verify = await h
      .http()
      .post('/api/v1/auth/otp/verify')
      .send({ phone: '0812345678', purpose: 'RESET', code: h.sms.lastCode('+66812345678') })
      .expect(200);
    await h
      .http()
      .post('/api/v1/auth/password/reset')
      .send({ verificationToken: verify.body.verificationToken, password: 'new-password-2' })
      .expect(200);

    await h.http().post('/api/v1/auth/refresh').set('Cookie', cookies).expect(401);
    await h.http().post('/api/v1/auth/login').send({ phone: '0812345678', password: 'new-password-2' }).expect(200);
  });

  it('rotates refresh tokens and revokes everything on reuse', async () => {
    const { cookies } = await signupShop(h, '0812345678', 'Shop');
    const first = await h.http().post('/api/v1/auth/refresh').set('Cookie', cookies).expect(200);
    const rotated = first.headers['set-cookie'] as unknown as string[];

    await h.http().post('/api/v1/auth/refresh').set('Cookie', cookies).expect(401); // replay of the old one
    await h.http().post('/api/v1/auth/refresh').set('Cookie', rotated).expect(401); // family revoked
  });

  it('rejects requests without a token', async () => {
    await h.http().get('/api/v1/auth/me').expect(401);
    await h.http().get('/api/v1/health').expect(200);
  });
});
