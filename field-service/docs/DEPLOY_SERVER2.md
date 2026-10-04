# Staging/pilot on server2 — plan (2026-10-04)

Decisions (user, 2026-10-04): install on **server2**; **staging/pilot first** (not production yet);
public HTTPS through **subdomains on the existing Cloudflare Tunnel**; database in a **new, separate
PostgreSQL 16 cluster**.

## What server2 has (surveyed read-only, 2026-10-04)

| Item | Found | Plan |
|---|---|---|
| OS / size | Ubuntu 24.04.2, 8 CPU, 15 GB RAM; `/` 23 GB free; `/data` 646 GB, `/data2`, `/data3` 466 GB | Code in `/opt`, media and backups on `/data`, erasure registry on `/data2` |
| Node | system v18, `/opt/node-22` | Install Node 24 LTS separately in `/opt/node-24` (system Node untouched); pnpm via corepack |
| Process manager | pm2 (root + ton07) runs ~20 other apps | 3 new pm2 apps, names prefixed `fs-staging-` |
| Web | Apache on 80/443 (other sites, Let's Encrypt); `cloudflared` service runs a token-managed tunnel | Our processes listen on 127.0.0.1 only; hostnames added to the tunnel in the Cloudflare dashboard |
| PostgreSQL | 16/main :5432 (dev `field_service` + other DBs), 16/test :5433 | New cluster **16/staging :5434, localhost only**, own fs_* roles and passwords |
| Firewall | ufw inactive; pg_hba allows localhost + Tailscale only | Nothing new listens on public interfaces |

## Layout

```
/opt/node-24/                          Node 24 LTS
/opt/field-service/staging/            code at a tagged commit, built on the server
/etc/field-service/staging.env         secrets, root:ton07 0640, generated on the server (never in chat or git)
/data/field-service/staging/media      private images
/data/field-service/staging/backups    daily dump + media (35 days)
/data2/field-service/erasure-registry.json   ERASURE_REGISTRY_FILE (outside the DB backup disk)
```

| Process (pm2) | Command | Listens |
|---|---|---|
| fs-staging-api | `node --env-file=/etc/field-service/staging.env apps/api/dist/main.js` | 127.0.0.1:4100 |
| fs-staging-worker | `node --env-file=... apps/api/dist/worker.js` | — |
| fs-staging-web | `next start -H 127.0.0.1 -p 3200` (console `/console`, owner web `/shop`, join `/join`) | 127.0.0.1:3200 |

Cloudflare Tunnel public hostnames (added by the domain owner in Cloudflare Zero Trust → the
existing tunnel → Public Hostnames):

| Hostname | Service |
|---|---|
| `api-staging.<domain>` | `http://localhost:4100` |
| `app-staging.<domain>` | `http://localhost:3200` |

Then `ADMIN_ORIGIN`, `OWNER_WEB_URL`, `JOIN_LINK_BASE_URL=https://app-staging.<domain>/join`, and the
mobile app's `EXPO_PUBLIC_API_URL=https://api-staging.<domain>`.

## Steps

1. Node 24 + pnpm in `/opt/node-24`.
2. `pg_createcluster 16 staging --port 5434 --start`, listen on localhost; create fs_migrator /
   fs_api / fs_worker / fs_platform from `infra/postgres/00-roles.sql` with generated passwords;
   database `field_service_staging`; run migrations 001–020 as fs_migrator; **no seed**.
3. Copy the code (git bundle of the branch from the dev PC; no git remote yet), `pnpm install
   --frozen-lockfile`, `pnpm build`.
4. Write `/etc/field-service/staging.env` on the server (random secrets generated there).
5. Start the 3 pm2 apps; `pm2 save`. Check `/v1/ready` and `CONFIG_MISSING` lines.
6. Tunnel hostnames (Cloudflare dashboard) → check HTTPS from outside.
7. First two console accounts with `scripts/platform-account.mjs` (credentials shown once, to the
   people themselves).
8. Daily backup cron (`DB_PORT=5434`) + `restore-check.sh`; record evidence in the console.
9. Mobile: Expo Go against the staging API for the device tests; later an APK.

## Open points

- **Domain**: which Cloudflare domain to use for the two staging hostnames, and who adds them in
  the Cloudflare dashboard (the tunnel is token-managed; its routes are not in a file on server2).
- **Sign-in on staging**: with `NODE_ENV=production` the development SMS adapter is refused, so
  real phones need **DeeSMSx keys** (or staging runs in development mode with OTP codes only in the
  server log — acceptable for internal testing, not for real shops).
- Payments on staging: Stripe test mode / EasySlip only with the user's keys and approval.
- OCR: `OCR_PROVIDER=claude` once `ANTHROPIC_API_KEY` is provided.
- Off-site backup target still to choose (the registry and backups on other local disks protect
  against one-disk loss only).
