# ServiceFlow — Architecture (v0.1)

> เอกสารนี้สรุป architecture ที่ตกลงแล้ว อ้างอิง requirement จาก [req.md](../req.md)
> อัปเดตล่าสุด: 2026-09-24

## 0. Decisions Log

| # | เรื่อง | ตัดสินใจ |
|---|---|---|
| D1 | Stack | TypeScript · NestJS · Prisma (SQL Server) · React + Vite + TanStack Query + Tailwind · npm workspaces monorepo · pin: Nest 11, Prisma 6, TS 5.9 (major ใหม่กว่านี้ค่อยอัปเกรดทีหลัง) |
| D2 | รูปแบบระบบ | Modular Monolith, 1 codebase / 2 process (`api`, `worker`), ไม่มี Redis/broker ใน MVP (ใช้ outbox table) |
| D3 | Hosting | **On-premise** — server ของเราเอง host ทุก tenant (shared DB, shared schema) |
| D4 | Object Storage | ผ่าน `ObjectStorage` adapter · ตอนนี้ใช้ `LocalDiskStorage` (`MEDIA_DIR`) · เป้าหมาย MinIO (S3-compatible, self-hosted) |
| D5 | LINE | MVP ใช้ **LINE OA กลางของ ServiceFlow** สำหรับช่าง/Owner · OA ของร้านเอง (ฝั่งลูกค้า) = 0.2 |
| D6 | Identity | **ไม่ใช้อีเมลทั้งระบบ** ใช้เบอร์โทร (เก็บ E.164 `+66…`) |
| D7 | Owner | สมัคร = เบอร์ + **SMS OTP** + ตั้งรหัสผ่าน · login = เบอร์ + รหัสผ่าน · ลืมรหัส = OTP · OTP สร้าง/ตรวจโดยระบบเราเอง ส่งผ่าน **DEESMSX Send SMS API** (`SMS_MODE=deesmsx`) |
| D8 | Technician | Owner ส่ง **invite link ทาง LINE ส่วนตัว** → ช่างเปิดใน LINE → ลงทะเบียนได้ทันที **ไม่ยืนยันเบอร์** · login ครั้งต่อไปด้วย LINE |
| D9 | Customer | ลงทะเบียนด้วยเบอร์อย่างเดียว **ไม่มี OTP** · เบอร์อย่างเดียวไม่พอจะเปิดดูข้อมูลเดิม (ดู §7.3) |
| D10 | AI | อยู่หลัง interface, มา Slice 5 · Nameplate = Vision LLM · Voice = Thai STT → LLM extraction · ต้องมี human confirm เสมอ |

## 1. ภาพรวม

```
Clients:  Web Admin (/admin)   Technician (/tech, เปิดใน LIFF)   Customer (/a/:token)
               │                       │                               │
               └──────── HTTPS (reverse proxy: Caddy/Nginx) ───────────┘
                                       │
                ┌──────────── API process (NestJS) ─────────────┐
                │ Guards (auth/tenant/role) → Controllers → Services → Repos │
                │ modules: tenant auth customer site asset job service-rule │
                │          event notification line media ai reporting search │
                └───────────────┬───────────────────────────────┘
                                │ business data + domain_event + outbox (1 tx)
                         ┌──────▼──────┐        ┌───────────────────────┐
                         │ SQL Server  │◄──poll─│ Worker process         │
                         └─────────────┘        │ notifications / retry  │
                         ┌─────────────┐        │ PM due / overdue scan  │
                         │   MinIO     │        │ daily summary / AI     │
                         └─────────────┘        └──────────┬────────────┘
                                                           ▼
                                              LINE API · SMS provider · AI provider
```

## 2. Modules

| Module | รับผิดชอบ | ข้อห้าม |
|---|---|---|
| `tenant` | signup ร้าน, settings | |
| `auth` | account, membership, OTP, invite, session, role | |
| `customer` | quick add, search, detail | ห้ามเป็น CRM |
| `site` | สถานที่ + พิกัด | |
| `asset` | create/enrich, QR token, warranty calc, timeline | |
| `job` | state machine, technician commands, part request | ห้ามเรียก LINE ตรง |
| `service-rule` | resolve rule, next_service_date, default price | |
| `event` | append/query domain events | append-only |
| `notification` | event → outbox → channel adapter, retry | ไม่มี business logic |
| `line` | webhook, signature, LIFF login, Flex messages | |
| `media` | upload, MIME/size validation, resize, storage | |
| `ai` | `AssetRecognitionService`, `VoiceExtractionService` (Manual / AI impl.) | ห้าม overwrite โดยไม่ confirm |
| `reporting` | dashboard, service due, revenue opportunity | read-only |
| `search` | global search | |

กฎ: เรียกข้าม module ผ่าน exported service เท่านั้น · side effect ข้าม module ผ่าน event/outbox · สิ่งที่ต้อง atomic อยู่ใน transaction เดียว

## 3. Database Schema

- `id INT IDENTITY` = ภายในเท่านั้น (Int แทน BigInt เพื่อเลี่ยงปัญหา BigInt ใน JSON; พอสำหรับหลายปี)
- SQL Server ถือว่า NULL ซ้ำกันใน UNIQUE → ห้าม `@unique` บนคอลัมน์ nullable (เช่นเบอร์ที่ยืนยันแล้วแยกเป็นตาราง `VerifiedPhone`) · `public_id` (ULID) = ใช้ใน API/URL · `job_no` = เลขอ่านง่ายต่อ tenant
- ทุกตารางธุรกิจมี `tenant_id`, `created_at`, `updated_at`, `deleted_at`
- **FK ทุกตัวเป็น composite `(tenant_id, x_id)`** กันอ้างข้าม tenant ที่ระดับ DB

```
tenant            (id, public_id, name, settings_json)

-- identity (ข้าม tenant)
account           (id, public_id, display_name, phone_e164?, phone_verified_at?,
                   password_hash?, status)
                   UNIQUE(phone_e164) WHERE phone_verified_at IS NOT NULL   -- filtered index
membership        (id, tenant_id, account_id, role[OWNER|ADMIN|DISPATCHER|TECHNICIAN], status)
                   UNIQUE(tenant_id, account_id)
line_identity     (id, line_channel_id, line_user_id, account_id?,
                   tenant_id?, customer_id?, linked_at)
                   UNIQUE(line_channel_id, line_user_id)
otp_challenge     (id, phone_e164, purpose[SIGNUP|RESET], code_hash, expires_at,
                   attempts, consumed_at?)
invite            (id, tenant_id, role, token_hash, created_by, expires_at,
                   accepted_at?, accepted_account_id?, revoked_at?)

-- core
customer          (id, tenant_id, public_id, display_name, phone_e164?,
                   phone_source[SHOP_ENTERED|SELF_REGISTERED]?, verified_at?, notes?)
site              (id, tenant_id, customer_id, display_name, lat?, lng?, address_text?, notes?)
asset_category    (id, tenant_id, name, issue_types_json, done_options_json)
asset             (id, tenant_id, public_id, customer_id, site_id?, category_id?,
                   brand?, model?, serial_number?, installed_at?, installed_by?,
                   warranty_start?, warranty_end?, next_service_date?, status,
                   primary_media_id?, field_sources_json)
asset_qr_token    (id, tenant_id, asset_id?, token UNIQUE, issued_at, revoked_at?)
warranty_rule     (id, tenant_id, scope_type, scope_value, months)
service_rule      (id, tenant_id, scope_type[CATEGORY|BRAND|MODEL|CUSTOMER|ASSET],
                   scope_value, interval_months, service_name, default_price?)
job               (id, tenant_id, public_id, job_no, asset_id?, customer_id, site_id?,
                   source[QR|LINE|ADMIN|TECH|PM|API], issue_type?, issue_note?, status,
                   assigned_membership_id?, outcome?, scheduled_for?,
                   accepted_at?, on_the_way_at?, arrived_at?, completed_at?)
part_used         (id, tenant_id, job_id, name, spec?, qty, source[MANUAL|AI])
part_request      (id, tenant_id, job_id, description?, media_id?, status, resolved_at?)
domain_event      (id, tenant_id, event_type, occurred_at, actor_type, actor_id?,
                   job_id?, asset_id?, customer_id?, metadata_json)       -- append-only
media             (id, tenant_id, owner_type, owner_id, kind, storage_key, mime, size, created_by)
ai_extraction     (id, tenant_id, media_id, kind, provider, model, raw_output_json,
                   confidence_json, status, confirmed_by?, final_values_json?)
notification_outbox (id, tenant_id, event_id, channel, recipient_ref, payload_json,
                   status, attempts, next_attempt_at, last_error?)
```

หมายเหตุ:
- **Service History = `domain_event WHERE asset_id = ?`** ไม่มีตารางแยก
- `asset.next_service_date` denormalize ไว้ + index `(tenant_id, next_service_date)` สำหรับ service due
- Booked = asset มี PM job เปิดอยู่ · Not Contacted = ไม่มี job และไม่มี `PM_REMINDER_SENT`
- ช่างไม่ยืนยันเบอร์ → เบอร์ช่างเป็นแค่ข้อมูลติดต่อ ตัวตนจริงคือ LINE identity (unique index เบอร์ใช้กับเบอร์ที่ verified แล้วเท่านั้น)

## 4. Job State Machine

```
NEW → ASSIGNED → ACCEPTED → ON_THE_WAY → ON_SITE → IN_PROGRESS → COMPLETED
                                              │          ├→ WAITING_PART ──→ ASSIGNED/IN_PROGRESS
                                              │          └→ NEED_RETURN_VISIT → ASSIGNED
 (ทุกสถานะที่ยังไม่ COMPLETED) → CANCELLED
```
ทุก transition = 1 command = 1 `domain_event` · transition ผิด → HTTP 409

## 5. API (REST `/api/v1`)

```
# Auth
POST /auth/otp/request        { phone, purpose: SIGNUP|RESET }
POST /auth/otp/verify
POST /auth/signup             (หลัง OTP) ชื่อร้าน + ชื่อ + รหัสผ่าน
POST /auth/login              { phone, password }
POST /auth/password/reset     (หลัง OTP)
POST /auth/line/liff          { idToken } → session (ช่าง)
POST /auth/switch-tenant
POST /auth/refresh | /auth/logout

# Invite
POST   /invites               { role } → { url }   (Owner copy ไปส่งใน LINE เอง)
GET    /invites               รายการ pending
DELETE /invites/:id           revoke
POST   /public/invites/:token/accept  { idToken, displayName, phone? }

# Core
GET|POST  /customers   GET|PATCH /customers/:id   POST /customers/:id/sites
POST      /assets      GET|PATCH /assets/:id      GET /assets/:id/timeline
POST      /assets/:id/qr
GET|POST  /jobs        GET /jobs/:id
POST /jobs/:id/{assign|accept|on-the-way|arrive|start|need-part|need-return|complete|cancel}
DELETE /memberships/:id       ปลดช่างออกจากร้าน

# Media / AI (Slice 5)
POST /media   POST /ai/nameplate   POST /ai/voice

# Reporting
GET /dashboard   GET /service-due?range=week|month|overdue   GET /search?q=

# Public (rate limited)
GET  /public/a/:token
POST /public/a/:token/requests
POST /webhooks/line/:channelId
```
`tenant_id` มาจาก session เท่านั้น ห้ามรับจาก body

## 6. Repository Layout

```
apps/api/src/{main.ts, worker.ts, common/, modules/*}
apps/api/prisma/schema.prisma
apps/api/test/                 integration + tenant isolation
apps/web/src/routes/{admin,tech,public}
packages/shared/               zod schemas, enums, DTO types
deploy/                        docker-compose / service configs สำหรับ on-prem
docs/                          architecture, ADRs
```

## 7. Authentication / Authorization

### 7.1 Owner / Admin / Dispatcher
เบอร์ + รหัสผ่าน (argon2) · access token 15 นาที · refresh token httpOnly cookie + rotation
OTP: หมดอายุ 5 นาที, ผิดได้ 5 ครั้ง, hash เก็บ, จำกัดต่อเบอร์/IP, รับเฉพาะเบอร์ไทย

### 7.2 Technician
1. Owner กด "เชิญช่าง" → ได้ link (single-use, หมดอายุ 7 วัน) → ส่งเองทาง LINE ส่วนตัว
2. ช่างเปิด link ใน LINE → LIFF login ได้ LINE user ID → กรอกชื่อ (+ เบอร์ ถ้าต้องการ) → เข้าใช้งานทันที
3. ระบบแจ้ง Owner ทาง LINE: "ช่าง X ลงทะเบียนแล้ว" พร้อมปุ่มปลดออก
4. ครั้งต่อไปเปิดผ่าน LINE = login อัตโนมัติ
- link หลุดไปคนอื่น → Owner revoke invite / ปลด membership ได้
- ช่างเปลี่ยนบัญชี LINE → Owner เชิญใหม่
- ช่างทำหลายร้าน → LINE user ID เดียวกัน (OA กลาง = provider เดียว) → account เดียว หลาย membership

### 7.3 Customer
- ไม่มี login ใน MVP · QR token = ระบุ asset
- ลงทะเบียนด้วยเบอร์ (ไม่มี OTP) → สร้าง/จับคู่ customer ได้ แต่ **เบอร์อย่างเดียวไม่เปิดข้อมูลเดิม**
- เห็นข้อมูลเดิมได้เมื่อมี: สแกน QR ของเครื่องนั้น / LINE ที่ผูกแล้ว / ร้านยืนยัน
- แจ้งงานใหม่ไม่ต้องมีหลักฐานใด ๆ

### 7.4 Tenant isolation
1. Guard → `TenantContext` (request scope)
2. Repository/Prisma extension บังคับ `tenant_id` ทุก query
3. Composite FK ที่ DB
4. Test บังคับ: เข้าถึงข้าม tenant ทุก endpoint ต้องได้ 404
5. (ภายหลัง) SQL Server RLS

Role: `@Roles()` decorator · ช่างเห็นเฉพาะงานที่ assign ให้ตัวเอง

## 8. LINE Integration

```
Command → tx { business data, domain_event, notification_outbox } → worker → LineAdapter → LINE API
```
- MVP: OA กลาง 1 ตัว (ช่าง + Owner) · 0.2: OA ของร้าน (secret เข้ารหัสต่อ tenant)
- `line_identity` key = `(line_channel_id, line_user_id)` เพราะ user ID ต่างกันตาม provider
- ปุ่มใน Flex (เช่น Accept) → postback → command เดียวกับ web · งานซับซ้อน → เปิด LIFF

## 9. On-premise Deployment

- Server: **Ubuntu** · SQL Server ติดตั้งแบบ native อยู่แล้ว (ใช้ instance เดิม, database แยก `serviceflow` / `serviceflow_dev` / `serviceflow_test`)
- Public HTTPS ผ่าน **Cloudflare Tunnel** (มีอยู่แล้ว) → TLS จบที่ Cloudflare, ไม่ต้องเปิด port / ไม่ต้องมี Caddy
  - `app.<domain>` → web + `/api` · LINE webhook, LIFF, หน้า QR ใช้ hostname นี้
  - API ต้อง trust `CF-Connecting-IP` สำหรับ rate limit
- Process: `api`, `worker` (Node, รันด้วย systemd หรือ Docker), `web` (static files เสิร์ฟโดย api หรือ nginx), `minio`
- Outbound internet: LINE API, SMS provider, AI provider (Slice 5)
- Backup: SQL Server full + log backup, MinIO bucket replication/rsync, สำเนา off-site
- SQL Server edition: Express จำกัด DB 10 GB — พอเริ่มต้น แต่ควรวางแผน Standard และตรวจเงื่อนไข license สำหรับการให้บริการ SaaS
- Secrets ผ่าน env file ที่ไม่อยู่ใน git

## 10. Assumptions
1. Server ของเราเองรันทุก tenant (ไม่ใช่ติดตั้งแยกให้แต่ละร้าน)
2. ร้านเล็ก ช่าง ≤ ~20, asset หลักหมื่นต่อ tenant
3. UI ภาษาไทยเป็นหลัก รองรับ i18n
4. `service_rule.default_price` ว่าง → dashboard แสดงจำนวนเครื่อง ไม่แสดงเงิน
5. เวลาเก็บเป็น UTC แสดง Asia/Bangkok

## 11. Deferred จาก MVP
Customer LINE flow / OA ของร้าน (0.2) · ระบบนัดหมาย · Import CSV/Excel · SQL Server RLS · permission matrix · full-text search · Redis/BullMQ · AI ทั้งหมด (Slice 5)

## 12. Milestones

| # | Milestone | Done เมื่อ |
|---|---|---|
| M0 | Skeleton: monorepo, Prisma + SQL Server, auth (Owner OTP/password, invite), tenant guard, CI | signup/login ได้ + tenant isolation test ผ่าน |
| M1 | Slice 1: customer, site, asset, job state machine, หน้าช่าง mobile, domain_event, timeline | Customer → Asset → Job → Assign → Accept → Arrive → Complete → Timeline end-to-end |
| M2 | Slice 2: warranty, service rule, next service, dashboard, service due + revenue | ปิดงานแล้วได้ next service และ Owner เห็นรายการ due |
| M3 | Slice 3: outbox worker, LINE OA กลาง, LIFF login ช่าง, แจ้งงาน/Accept ผ่าน LINE | ผ่าน MVP Success Criterion (req §43) |
| M4 | Slice 4: QR sticker PDF, หน้า public, ลูกค้าแจ้งงาน, rate limit | แจ้งงาน ≤ 3 actions หลัง scan |
| M5 | Slice 5: AI nameplate + voice, ai_extraction, วัดผลด้วยชุดรูปจริง | ผ่านเกณฑ์ accuracy + AI ล่มแล้ว workflow ยังเดิน |
