import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createHarness, Harness, hasTestDb, inviteAndJoin, signupShop, TINY_JPEG } from './harness';

describe.skipIf(!hasTestDb)('customers, sites, assets, media', () => {
  let h: Harness;
  let shop: Awaited<ReturnType<typeof signupShop>>;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => h?.close());
  beforeEach(async () => {
    await h.reset();
    shop = await signupShop(h, '0811111111', 'ร้านแอร์ A');
  });

  const post = (path: string, body: unknown, token = shop.token) =>
    h.http().post(`/api/v1${path}`).set(bearer(token)).send(body as object);
  const get = (path: string, token = shop.token) => h.http().get(`/api/v1${path}`).set(bearer(token));

  it('seeds asset categories at signup', async () => {
    const res = await get('/asset-categories').expect(200);
    expect(res.body.map((c: { name: string }) => c.name)).toEqual(['แอร์', 'เครื่องกรองน้ำ', 'กล้องวงจรปิด', 'ปั๊มน้ำ', 'อื่น ๆ']);
    expect(res.body[0].issueTypes).toContain('ไม่เย็น');
  });

  it('creates an asset from just a new customer name (zero-form)', async () => {
    const res = await post('/assets', { newCustomer: { displayName: 'คุณสมชาย' } }).expect(201);
    expect(res.body.customer.displayName).toBe('คุณสมชาย');
    expect(res.body.installedBy).toBe('Owner of ร้านแอร์ A');
    expect(new Date(res.body.installedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(res.body.label).toBe('เครื่อง');
    expect(res.body.timeline).toHaveLength(1);
    expect(res.body.timeline[0]).toMatchObject({ type: 'ASSET_INSTALLED', actorName: 'Owner of ร้านแอร์ A' });
  });

  it('uses the only site automatically and rejects another customer’s site', async () => {
    const c1 = await post('/customers', { displayName: 'ลูกค้า 1', phone: '081-234-5678', site: { lat: 13.7, lng: 100.5 } }).expect(201);
    const c2 = await post('/customers', { displayName: 'ลูกค้า 2', site: { displayName: 'ร้านค้า' } }).expect(201);
    expect(c1.body.sites[0].displayName).toBe('สถานที่หลัก');

    const cats = await get('/asset-categories');
    const asset = await post('/assets', {
      customerId: c1.body.id,
      categoryId: cats.body[0].id,
      brand: 'Daikin',
      model: 'FTKF18',
      serialNumber: 'SN-001',
    }).expect(201);
    expect(asset.body.site.id).toBe(c1.body.sites[0].id);
    expect(asset.body.label).toBe('Daikin FTKF18');
    expect(asset.body.category.name).toBe('แอร์');

    await post('/assets', { customerId: c1.body.id, siteId: c2.body.sites[0].id }).expect(400);
  });

  it('attaches an uploaded photo and serves it through a signed URL only', async () => {
    const up = await h
      .http()
      .post('/api/v1/media?kind=NAMEPLATE')
      .set(bearer(shop.token))
      .attach('file', TINY_JPEG, { filename: 'plate.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect(up.body.mime).toBe('image/jpeg');

    const asset = await post('/assets', { newCustomer: { displayName: 'X' }, primaryMediaId: up.body.id }).expect(201);
    const photo = await h.http().get(asset.body.photoUrl).expect(200);
    expect(photo.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(photo.body as Buffer, TINY_JPEG)).toBe(0);

    await h.http().get(asset.body.photoUrl.replace(/sig=[0-9a-f]{4}/, 'sig=0000')).expect(404);
    await h.http().get(`/api/v1/public/media/${up.body.id}`).expect(404);

    // A photo can't be reused for a second asset.
    await post('/assets', { newCustomer: { displayName: 'Y' }, primaryMediaId: up.body.id }).expect(400);
  });

  it('rejects files that are not images regardless of declared type', async () => {
    await h
      .http()
      .post('/api/v1/media')
      .set(bearer(shop.token))
      .attach('file', Buffer.from('%PDF-1.4 not an image'), { filename: 'x.jpg', contentType: 'image/jpeg' })
      .expect(415);
  });

  it('finds customers by forgiving phone, name, and serial search', async () => {
    const c = await post('/customers', { displayName: 'คุณวิภา', phone: '0812345678' }).expect(201);
    await post('/assets', { customerId: c.body.id, serialNumber: 'ABC-778899' }).expect(201);
    await post('/customers', { displayName: 'คุณอื่น', phone: '0899999999' }).expect(201);

    for (const q of ['081-234', '+66812345678', '5678', 'วิภา', '778899']) {
      const res = await get(`/customers?q=${encodeURIComponent(q)}`).expect(200);
      expect(res.body.map((x: { displayName: string }) => x.displayName), q).toEqual(['คุณวิภา']);
    }
    const detail = await get(`/customers/${c.body.id}`).expect(200);
    expect(detail.body.phone).toBe('081-234-5678');
    expect(detail.body.assets).toHaveLength(1);
  });

  it('lets a technician add a customer and asset on site', async () => {
    const { session } = await inviteAndJoin(h, shop.token, 'U-tech', 'ช่างบี');
    const res = await post('/assets', { newCustomer: { displayName: 'ลูกค้าหน้างาน' } }, session.accessToken).expect(201);
    expect(res.body.installedBy).toBe('ช่างบี');
    await h
      .http()
      .patch(`/api/v1/customers/${res.body.customer.id}`)
      .set(bearer(session.accessToken))
      .send({ displayName: 'x' })
      .expect(403);
  });

  it('keeps shops apart', async () => {
    const b = await signupShop(h, '0822222222', 'ร้าน B');
    const c = await post('/customers', { displayName: 'ลูกค้าของ A' }).expect(201);
    const asset = await post('/assets', { customerId: c.body.id }).expect(201);
    const up = await h
      .http()
      .post('/api/v1/media')
      .set(bearer(shop.token))
      .attach('file', TINY_JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);

    await get(`/customers/${c.body.id}`, b.token).expect(404);
    await get(`/assets/${asset.body.id}`, b.token).expect(404);
    await post('/assets', { customerId: c.body.id }, b.token).expect(404);
    await post('/assets', { newCustomer: { displayName: 'B' }, primaryMediaId: up.body.id }, b.token).expect(400);
    await post(`/customers/${c.body.id}/sites`, { displayName: 'x' }, b.token).expect(404);

    const list = await get('/customers', b.token).expect(200);
    expect(list.body).toEqual([]);
  });
});
