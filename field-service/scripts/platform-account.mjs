// Platform console accounts, run by the server operator (there is no sign-up and no built-in
// root account). Connects with MIGRATION_DATABASE_URL (owner of the platform tables) and seals
// TOTP secrets with PLATFORM_SECRET_KEY. Passwords and TOTP secrets are printed once.
//
//   node --env-file=.env scripts/platform-account.mjs create --email a@b.co --name "Somchai" --roles billing_operator
//   node --env-file=.env scripts/platform-account.mjs reset --email a@b.co      (new password + TOTP, sessions revoked)
//   node --env-file=.env scripts/platform-account.mjs roles --email a@b.co --roles support_agent,auditor
//   node --env-file=.env scripts/platform-account.mjs disable --email a@b.co
//   node --env-file=.env scripts/platform-account.mjs list
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { encrypt } from '../apps/api/dist/shared/crypto.js';
import { hashPassword, newTotpSecret, otpauthUri } from '../apps/api/dist/platform/secrets.js';

const roles = ['super_admin', 'platform_admin', 'billing_operator', 'billing_approver', 'support_agent', 'operations', 'auditor'];
const [command, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) args[rest[i].replace(/^--/, '')] = rest[i + 1];

function fail(message) { console.error(message); process.exit(1); }
const key = Buffer.from(process.env.PLATFORM_SECRET_KEY ?? '', 'base64');
if (command !== 'list' && key.length !== 32) fail('PLATFORM_SECRET_KEY must be 32 bytes, base64');
if (!process.env.MIGRATION_DATABASE_URL) fail('MIGRATION_DATABASE_URL is required');
const email = (args.email ?? '').trim().toLowerCase();
if (command !== 'list' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('--email is required');
const wanted = (args.roles ?? '').split(',').map(r => r.trim()).filter(Boolean);
if (wanted.some(r => !roles.includes(r))) fail(`roles: ${roles.join(', ')}`);

const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  const audit = (action, accountId, details = {}) => client.query(
    'INSERT INTO platform.audit_logs(actor_account_id, action, target_type, target_id, details) VALUES (NULL, $1, $2, $3, $4)', [action, 'account', accountId, details]);
  const setRoles = async accountId => {
    await client.query('DELETE FROM platform.account_roles WHERE account_id = $1', [accountId]);
    await client.query('INSERT INTO platform.account_roles(account_id, role_id) SELECT $1, id FROM platform.roles WHERE code = ANY($2)', [accountId, wanted]);
  };
  const credentials = async () => {
    const password = randomBytes(15).toString('base64url');
    const secret = newTotpSecret();
    return { password, secret, hash: await hashPassword(password), sealed: encrypt(key, secret) };
  };
  const show = (c) => {
    console.log(`password (shown once): ${c.password}`);
    console.log(`TOTP secret: ${c.secret}`);
    console.log(`authenticator URI: ${otpauthUri(c.secret, email)}`);
  };

  if (command === 'create') {
    if (!args.name || !wanted.length) fail('--name and --roles are required');
    const c = await credentials();
    const row = (await client.query(`INSERT INTO platform.accounts(display_name, email, preferred_language, status, password_hash, totp_secret_sealed)
      VALUES ($1,$2,$3,'active',$4,$5) RETURNING id`, [args.name, email, args.language === 'en' ? 'en' : 'th', c.hash, c.sealed])).rows[0];
    await setRoles(row.id);
    await audit('account.created_by_operator', row.id, { roles: wanted });
    console.log(`created ${email} (${wanted.join(', ')})`); show(c);
  } else if (command === 'reset' || command === 'disable' || command === 'roles') {
    const row = (await client.query('SELECT id FROM platform.accounts WHERE email = $1 FOR UPDATE', [email])).rows[0];
    if (!row) fail('no such account');
    if (command === 'roles') {
      if (!wanted.length) fail('--roles is required');
      await setRoles(row.id); await audit('account.roles_set_by_operator', row.id, { roles: wanted });
      console.log(`roles of ${email}: ${wanted.join(', ')}`);
    } else {
      await client.query('UPDATE platform.sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL', [row.id]);
      if (command === 'disable') {
        await client.query("UPDATE platform.accounts SET status = 'disabled' WHERE id = $1", [row.id]);
        await audit('account.disabled_by_operator', row.id); console.log(`disabled ${email}; sessions revoked`);
      } else {
        const c = await credentials();
        await client.query(`UPDATE platform.accounts SET password_hash = $2, totp_secret_sealed = $3, totp_last_step = 0, failed_logins = 0, locked_until = NULL,
          mfa_enrolled = false, status = 'active' WHERE id = $1`, [row.id, c.hash, c.sealed]);
        await audit('account.reset_by_operator', row.id); console.log(`reset ${email}; sessions revoked`); show(c);
      }
    }
  } else if (command === 'list') {
    const rows = (await client.query(`SELECT a.email, a.display_name, a.status, a.last_login_at, coalesce(string_agg(r.code, ',' ORDER BY r.code), '') AS roles
      FROM platform.accounts a LEFT JOIN platform.account_roles ar ON ar.account_id = a.id LEFT JOIN platform.roles r ON r.id = ar.role_id
      GROUP BY a.id ORDER BY a.email`)).rows;
    console.table(rows);
  } else fail('commands: create | reset | roles | disable | list');
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  fail(error instanceof Error ? error.message : String(error));
} finally { await client.end(); }
