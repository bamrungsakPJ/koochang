# ServiceFlow

After-sales service SaaS for dealer + installation businesses. Requirements: [req.md](req.md) · Architecture: [docs/architecture.md](docs/architecture.md)

## Layout

```
apps/api          NestJS API (+ worker later), Prisma on SQL Server
packages/shared   zod schemas, enums, Thai phone helpers (used by API and web)
docs/             architecture + decisions
```

## Setup (dev)

Dev machine: Windows, Node 22+. Dev database: SQL Server on the Ubuntu server.

1. On the Ubuntu SQL Server, run [deploy/sql/dev-setup.sql](deploy/sql/dev-setup.sql) (creates
   `serviceflow_dev`, `serviceflow_test` and a `serviceflow_dev` login). The test database is wiped
   by the tests; its name must contain `test`.
   Check the Windows machine can reach it: `Test-NetConnection <server> -Port 1433` (PowerShell).
2. Configure the API (PowerShell: `Copy-Item apps/api/.env.example apps/api/.env`):
   ```bash
   cp apps/api/.env.example apps/api/.env
   ```
   Fill in `DATABASE_URL`, `DATABASE_URL_TEST` and `JWT_SECRET`.
3. Install, build shared, migrate:
   ```bash
   npm install
   npm run build -w @serviceflow/shared
   npm run db:migrate -w @serviceflow/api
   ```
4. Run:
   ```bash
   npm run dev:api        # http://localhost:3000/api/v1/health
   npm test               # unit + integration (integration needs DATABASE_URL_TEST)
   npm run typecheck
   ```

In dev, SMS OTPs are printed to the API log (`SMS_MODE=console`), and LINE login accepts
fake tokens `dev:<lineUserId>:<name>` (`LINE_AUTH_MODE=dev`). Both are refused when `NODE_ENV=production`.

## Changing the schema

Edit `apps/api/prisma/schema.prisma`, then create a migration against the dev database:

```bash
cd apps/api && npx prisma migrate dev --name <change>
```

`migrate dev` needs permission to create a temporary shadow database on the SQL Server
(or set `shadowDatabaseUrl`). Never use `migrate dev` against production — production runs `npm run db:migrate`.
