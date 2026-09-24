import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, Harness, hasTestDb, inviteAndJoin, signupShop, TINY_JPEG } from './harness';

describe.skipIf(!hasTestDb)('jobs: Customer → Asset → Job → Technician → Complete → History', () => {
  let h: Harness;
  let owner: string;
  let tech: string;
  let techId: string;
  let assetId: string;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => h?.close());
  beforeEach(async () => {
    await h.reset();
    owner = (await signupShop(h, '0811111111', 'ร้านแอร์ A')).token;
    tech = (await inviteAndJoin(h, owner, 'U-tech-a', 'ช่างเอ')).session.accessToken;
    const members = await get('/memberships');
    techId = members.body.find((m: { role: string }) => m.role === 'TECHNICIAN').id;
    const asset = await post('/assets', {
      newCustomer: { displayName: 'คุณสมชาย', phone: '0812345678' },
      newSite: { displayName: 'บ้าน', lat: 13.75, lng: 100.5 },
      brand: 'Daikin',
      model: 'FTKF18',
    }).expect(201);
    assetId = asset.body.id;
  });

  const post = (path: string, body: unknown = {}, token = owner) =>
    h.http().post(`/api/v1${path}`).set(bearer(token)).send(body as object);
  const get = (path: string, token = owner) => h.http().get(`/api/v1${path}`).set(bearer(token));

  it('runs the whole MVP flow with no long forms', async () => {
    // Admin: create from the asset — customer and site are filled in automatically.
    const created = await post('/jobs', { assetId, issueType: 'ไม่เย็น' }).expect(201);
    expect(created.body).toMatchObject({
      jobNo: 'J-000001',
      status: 'NEW',
      customerName: 'คุณสมชาย',
      siteName: 'บ้าน',
      assetLabel: 'Daikin FTKF18',
    });
    const id = created.body.id;

    await post(`/jobs/${id}/assign`, { assigneeId: techId }).expect(200);

    // Technician sees it and taps through.
    const mine = await get('/jobs?status=open', tech).expect(200);
    expect(mine.body.map((j: { id: string }) => j.id)).toEqual([id]);
    expect((await get(`/jobs/${id}`, tech)).body.allowedActions).toEqual(['accept']);

    await post(`/jobs/${id}/accept`, {}, tech).expect(200);
    await post(`/jobs/${id}/on-the-way`, {}, tech).expect(200);
    const onSite = await post(`/jobs/${id}/arrive`, {}, tech).expect(200);
    expect(onSite.body.status).toBe('ON_SITE');
    expect(onSite.body.allowedActions).toEqual(['start', 'need-part', 'need-return', 'complete']);
    expect(onSite.body.site).toMatchObject({ lat: 13.75, lng: 100.5 });

    const photo = await h
      .http()
      .post('/api/v1/media?kind=AFTER')
      .set(bearer(tech))
      .attach('file', TINY_JPEG, { filename: 'after.jpg', contentType: 'image/jpeg' })
      .expect(201);

    const done = await post(
      `/jobs/${id}/complete`,
      { workTypes: ['REPLACE_PART'], parts: [{ name: 'Capacitor', spec: '35uF', qty: 1 }], mediaIds: [photo.body.id] },
      tech,
    ).expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.timestamps.completedAt).toBeTruthy();
    expect(done.body.partsUsed).toEqual([{ name: 'Capacitor', spec: '35uF', qty: 1 }]);
    expect(done.body.photos).toHaveLength(1);
    expect(done.body.events.map((e: { type: string }) => e.type)).toEqual([
      'JOB_CREATED',
      'TECHNICIAN_ASSIGNED',
      'JOB_ACCEPTED',
      'TECHNICIAN_ON_THE_WAY',
      'TECHNICIAN_ON_SITE',
      'JOB_COMPLETED',
    ]);

    // Asset history writes itself.
    const asset = await get(`/assets/${assetId}`).expect(200);
    expect(asset.body.timeline.map((e: { type: string }) => e.type)).toEqual(['JOB_COMPLETED', 'JOB_CREATED', 'ASSET_INSTALLED']);
    expect(asset.body.timeline[0]).toMatchObject({
      actorName: 'ช่างเอ',
      job: { jobNo: 'J-000001' },
      details: { workTypes: ['REPLACE_PART'], parts: ['Capacitor 35uF'] },
    });
    expect(asset.body.openJobs).toEqual([]);

    // Next job on the same asset shows previous service to the technician.
    const next = await post('/jobs', { assetId, assigneeId: techId }).expect(201);
    expect(next.body.jobNo).toBe('J-000002');
    expect(next.body.status).toBe('ASSIGNED');
    expect(next.body.previousService).toMatchObject([{ jobNo: 'J-000001', workTypes: ['REPLACE_PART'], parts: ['Capacitor 35uF'] }]);
  });

  it('enforces the order of steps and who may take them', async () => {
    const id = (await post('/jobs', { assetId, assigneeId: techId }).expect(201)).body.id;
    await post(`/jobs/${id}/arrive`, {}, tech).expect(409);
    await post(`/jobs/${id}/accept`).expect(403); // owner is not the assignee
    await post(`/jobs/${id}/cancel`, {}, tech).expect(403);

    const other = (await inviteAndJoin(h, owner, 'U-tech-b', 'ช่างบี')).session.accessToken;
    await get(`/jobs/${id}`, other).expect(404);
    await post(`/jobs/${id}/accept`, {}, other).expect(404);
    expect((await get('/jobs', other)).body).toEqual([]);

    await post(`/jobs/${id}/accept`, {}, tech).expect(200);
    await post(`/jobs/${id}/accept`, {}, tech).expect(409);
  });

  it('parks a job for parts, then re-assigns and finishes it', async () => {
    const id = (await post('/jobs', { assetId, assigneeId: techId }).expect(201)).body.id;
    await post(`/jobs/${id}/accept`, {}, tech);
    await post(`/jobs/${id}/arrive`, {}, tech);
    await post(`/jobs/${id}/need-part`, {}, tech).expect(400); // needs a name or photo
    const waiting = await post(`/jobs/${id}/need-part`, { description: 'คอมเพรสเซอร์' }, tech).expect(200);
    expect(waiting.body.status).toBe('WAITING_PART');
    expect(waiting.body.partRequests).toMatchObject([{ description: 'คอมเพรสเซอร์', status: 'REQUESTED' }]);

    const waitingList = await get('/jobs?status=WAITING_PART').expect(200);
    expect(waitingList.body).toHaveLength(1);

    const again = await post(`/jobs/${id}/assign`, { assigneeId: techId }).expect(200);
    expect(again.body.status).toBe('ASSIGNED');
    expect(again.body.timestamps.arrivedAt).toBeNull();
    expect(again.body.partRequests[0].status).toBe('RESOLVED');

    await post(`/jobs/${id}/accept`, {}, tech);
    await post(`/jobs/${id}/arrive`, {}, tech);
    await post(`/jobs/${id}/complete`, { workTypes: [] }, tech).expect(400);
    await post(`/jobs/${id}/complete`, { workTypes: ['REPAIR'] }, tech).expect(200);
  });

  it('records a needed return visit, cancellations, and manager close-outs', async () => {
    const a = (await post('/jobs', { assetId, assigneeId: techId }).expect(201)).body.id;
    await post(`/jobs/${a}/accept`, {}, tech);
    await post(`/jobs/${a}/arrive`, {}, tech);
    const ret = await post(`/jobs/${a}/need-return`, { note: 'ลูกค้าไม่อยู่' }, tech).expect(200);
    expect(ret.body).toMatchObject({ status: 'NEED_RETURN_VISIT', returnNote: 'ลูกค้าไม่อยู่' });

    const b = (await post('/jobs', { assetId }).expect(201)).body.id;
    const cancelled = await post(`/jobs/${b}/cancel`, { reason: 'ลูกค้ายกเลิก' }).expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    await post(`/jobs/${b}/assign`, { assigneeId: techId }).expect(409);

    // Fixed over the phone: owner closes it without a visit.
    const c = (await post('/jobs', { assetId }).expect(201)).body.id;
    await post(`/jobs/${c}/complete`, { workTypes: ['ADJUSTMENT'], note: 'แนะนำทางโทรศัพท์' }).expect(200);
  });

  it('lets a technician log a job they found on site (assigned to themselves)', async () => {
    const res = await post('/jobs', { assetId, issueType: 'น้ำหยด' }, tech).expect(201);
    expect(res.body).toMatchObject({ status: 'ASSIGNED', source: 'TECH', assignee: { displayName: 'ช่างเอ' } });
  });

  it('keeps jobs inside their shop', async () => {
    const b = await signupShop(h, '0822222222', 'ร้าน B');
    const id = (await post('/jobs', { assetId }).expect(201)).body.id;

    await get(`/jobs/${id}`, b.token).expect(404);
    await post(`/jobs/${id}/cancel`, {}, b.token).expect(404);
    await post('/jobs', { assetId }, b.token).expect(404);

    const bAsset = (await post('/assets', { newCustomer: { displayName: 'ลูกค้า B' } }, b.token).expect(201)).body.id;
    await post('/jobs', { assetId: bAsset, assigneeId: techId }, b.token).expect(400);
    expect((await get('/jobs', b.token)).body).toEqual([]);
  });
});
