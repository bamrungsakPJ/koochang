import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

/** Helpers that drive the auth.* functions as the runtime role, like the API does. */
export function actors(db) {
  const hex = value => createHash('sha256').update(value).digest('hex');
  let phoneSeq = 0;
  const prefix = String(Math.floor(Math.random() * 90) + 10);
  const newPhone = () => `+669${prefix}${String(100000 + phoneSeq++).slice(-6)}`;

  async function api(sql, params, client) {
    const run = client ? (s, p) => client.query(s, p) : (s, p) => db.query(s, p);
    if (client) await client.query('BEGIN; SET LOCAL ROLE fs_api;'); else await db.exec('BEGIN; SET LOCAL ROLE fs_api;');
    try { const result = (await run(sql, params)).rows; await run('COMMIT'); return result; }
    catch (error) { await run('ROLLBACK'); throw error; }
  }
  const one = async (sql, params, client) => (await api(sql, params, client))[0];

  async function signIn(name = 'Tester') {
    const phone = newPhone(), id = randomUUID(), code = '123456';
    await one('SELECT * FROM auth.create_otp_challenge($1,$2,$3,NULL,300,5,30,20,1000)', [id, phone, hex(`${id}:${code}`)]);
    const row = await one('SELECT * FROM auth.verify_otp($1,$2,$3,$4,$5,1800,$6,86400)', [id, hex(`${id}:${code}`), name, 'th', hex(randomUUID()), hex(randomUUID())]);
    assert.equal(row.outcome, 'ok');
    return { userId: row.user_id };
  }
  async function createShop(name = 'Shop') {
    const owner = await signIn(`${name} owner`);
    const token = randomUUID();
    const row = await one('SELECT * FROM auth.create_organization($1,$2,$3,$4,$5,$6,$7)', [owner.userId, name, null, 'th', hex(token), 'sealed', randomUUID()]);
    assert.equal(row.outcome, 'created');
    return { owner, organizationId: row.organization_id, token };
  }
  const requestJoin = (user, token) => one('SELECT * FROM auth.request_join($1,$2,$3,$4)', [user.userId, hex(token), 'Tech', randomUUID()]);
  async function change(actor, organizationId, memberId, action) {
    const version = (await db.query('SELECT version FROM core.organization_members WHERE id = $1', [memberId])).rows[0].version;
    return one('SELECT * FROM auth.change_member_status($1,$2,$3,$4,$5,NULL,$6)', [actor.userId, organizationId, memberId, action, version, randomUUID()]);
  }
  async function addTechnician(shop) {
    const tech = await signIn('Tech');
    const { member_id: memberId } = await requestJoin(tech, shop.token);
    return { ...tech, memberId };
  }
  return { hex, api, one, signIn, createShop, requestJoin, change, addTechnician };
}
