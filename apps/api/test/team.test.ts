import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, Harness, hasTestDb, inviteAndJoin, signupShop } from './harness';

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe.skipIf(!hasTestDb)('team: technician invite via LINE', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => h?.close());
  beforeEach(async () => h.reset());

  it('technician joins from the invite link without phone verification', async () => {
    const shop = await signupShop(h, '0811111111', 'ร้าน A');
    const { inviteToken, session } = await inviteAndJoin(h, shop.token, 'U-tech-1', 'ช่างเอ');

    expect(session.activeTenantId).toBe(shop.tenantId);
    expect(session.tenants).toEqual([{ id: shop.tenantId, name: 'ร้าน A', role: 'TECHNICIAN' }]);

    const members = await h.http().get('/api/v1/memberships').set(bearer(shop.token)).expect(200);
    expect(members.body.map((m: { displayName: string }) => m.displayName)).toEqual(['Owner of ร้าน A', 'ช่างเอ']);
    expect(members.body[1].phone).toBe('089-999-0000');

    // Single use.
    await h.http().get(`/api/v1/public/invites/${inviteToken}`).expect(410);
    await h
      .http()
      .post(`/api/v1/public/invites/${inviteToken}/accept`)
      .send({ lineIdToken: 'dev:U-other:x', displayName: 'x' })
      .expect(410);

    // Next time: LINE login only.
    const login = await h.http().post('/api/v1/auth/line').send({ lineIdToken: 'dev:U-tech-1:ช่างเอ' }).expect(200);
    expect(login.body.activeTenantId).toBe(shop.tenantId);

    const events = await h.prisma.domainEvent.findMany({ orderBy: { id: 'asc' } });
    expect(events.map((e) => e.eventType)).toEqual(['TENANT_CREATED', 'MEMBER_INVITED', 'MEMBER_JOINED']);
  });

  it('shows the shop name before joining', async () => {
    const shop = await signupShop(h, '0811111111', 'ร้าน A');
    const invite = await h.http().post('/api/v1/invites').set(bearer(shop.token)).send({}).expect(201);
    const token = invite.body.url.split('/join/')[1];
    const preview = await h.http().get(`/api/v1/public/invites/${token}`).expect(200);
    expect(preview.body).toEqual({ shopName: 'ร้าน A', role: 'TECHNICIAN' });
  });

  it('unknown LINE user cannot log in', async () => {
    await h.http().post('/api/v1/auth/line').send({ lineIdToken: 'dev:U-nobody:x' }).expect(404);
  });

  it('revoked invite cannot be used', async () => {
    const shop = await signupShop(h, '0811111111', 'ร้าน A');
    const invite = await h.http().post('/api/v1/invites').set(bearer(shop.token)).send({}).expect(201);
    await h.http().delete(`/api/v1/invites/${invite.body.id}`).set(bearer(shop.token)).expect(204);
    const token = invite.body.url.split('/join/')[1];
    await h
      .http()
      .post(`/api/v1/public/invites/${token}/accept`)
      .send({ lineIdToken: 'dev:U-1:x', displayName: 'x' })
      .expect(410);
  });

  it('technicians cannot invite or remove members', async () => {
    const shop = await signupShop(h, '0811111111', 'ร้าน A');
    const { session } = await inviteAndJoin(h, shop.token, 'U-tech-1', 'ช่างเอ');
    await h.http().post('/api/v1/invites').set(bearer(session.accessToken)).send({}).expect(403);
    await h.http().get('/api/v1/memberships').set(bearer(session.accessToken)).expect(403);
  });

  it('removed technician loses access immediately', async () => {
    const shop = await signupShop(h, '0811111111', 'ร้าน A');
    const { session } = await inviteAndJoin(h, shop.token, 'U-tech-1', 'ช่างเอ');
    const members = await h.http().get('/api/v1/memberships').set(bearer(shop.token)).expect(200);
    const techId = members.body[1].id;

    await h.http().delete(`/api/v1/memberships/${techId}`).set(bearer(shop.token)).expect(204);
    await h.http().get('/api/v1/auth/me').set(bearer(session.accessToken)).expect(401);
  });

  it('one technician can work for two shops with one LINE account', async () => {
    const a = await signupShop(h, '0811111111', 'ร้าน A');
    const b = await signupShop(h, '0822222222', 'ร้าน B');
    await inviteAndJoin(h, a.token, 'U-tech-1', 'ช่างเอ');
    await inviteAndJoin(h, b.token, 'U-tech-1', 'ช่างเอ');

    const login = await h.http().post('/api/v1/auth/line').send({ lineIdToken: 'dev:U-tech-1:ช่างเอ' }).expect(200);
    expect(login.body.tenants).toHaveLength(2);
    expect(login.body.activeTenantId).toBeNull();

    const switched = await h
      .http()
      .post('/api/v1/auth/switch-tenant')
      .set(bearer(login.body.accessToken))
      .send({ tenantId: b.tenantId })
      .expect(200);
    expect(switched.body.activeTenantId).toBe(b.tenantId);
    expect(await h.prisma.account.count()).toBe(3); // 2 owners + 1 technician
  });
});

describe.skipIf(!hasTestDb)('tenant isolation', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => h?.close());
  beforeEach(async () => h.reset());

  it('shop B cannot see or touch shop A members and invites', async () => {
    const a = await signupShop(h, '0811111111', 'ร้าน A');
    const b = await signupShop(h, '0822222222', 'ร้าน B');
    await inviteAndJoin(h, a.token, 'U-tech-1', 'ช่างเอ');
    const pendingA = await h.http().post('/api/v1/invites').set(bearer(a.token)).send({}).expect(201);

    const membersA = await h.http().get('/api/v1/memberships').set(bearer(a.token)).expect(200);
    const membersB = await h.http().get('/api/v1/memberships').set(bearer(b.token)).expect(200);
    expect(membersB.body).toHaveLength(1);
    expect(membersB.body[0].displayName).toBe('Owner of ร้าน B');

    const invitesB = await h.http().get('/api/v1/invites').set(bearer(b.token)).expect(200);
    expect(invitesB.body).toEqual([]);

    for (const m of membersA.body) {
      await h.http().delete(`/api/v1/memberships/${m.id}`).set(bearer(b.token)).expect(404);
    }
    await h.http().delete(`/api/v1/invites/${pendingA.body.id}`).set(bearer(b.token)).expect(404);

    const stillA = await h.http().get('/api/v1/memberships').set(bearer(a.token)).expect(200);
    expect(stillA.body).toHaveLength(2);
  });

  it('cannot switch into a shop you do not belong to', async () => {
    const a = await signupShop(h, '0811111111', 'ร้าน A');
    const b = await signupShop(h, '0822222222', 'ร้าน B');
    await h.http().post('/api/v1/auth/switch-tenant').set(bearer(a.token)).send({ tenantId: b.tenantId }).expect(403);
  });

  it('scoped client refuses cross-tenant writes', async () => {
    const a = await signupShop(h, '0811111111', 'ร้าน A');
    const b = await signupShop(h, '0822222222', 'ร้าน B');
    const [ta, tb] = await Promise.all([
      h.prisma.tenant.findUniqueOrThrow({ where: { publicId: a.tenantId } }),
      h.prisma.tenant.findUniqueOrThrow({ where: { publicId: b.tenantId } }),
    ]);
    const scopedA = h.prisma.forTenant(ta.id);

    await expect(
      scopedA.domainEvent.create({ data: { tenantId: tb.id, eventType: 'X', actorType: 'SYSTEM' } }),
    ).rejects.toThrow(/Cross-tenant/);
    expect(await scopedA.membership.count()).toBe(1);
    await expect(scopedA.membership.findFirst({ where: { tenantId: tb.id } })).rejects.toThrow(/Cross-tenant/);
  });
});
