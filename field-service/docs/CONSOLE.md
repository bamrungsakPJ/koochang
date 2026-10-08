# Platform console

The platform uses `/console` with its own email/password + mandatory authenticator login.
Shop sessions and platform sessions remain separate. Thai and English are available throughout.

## Available workspaces

- **Overview**: queues, shops by state, pilot indicators and open incidents (accounts with `system.read`).
- **Shops** (50 per page, search by name/ID/last four phone digits), subscription history, security
  suspension and temporary grants.
- **Plans and prices**: drafts → approval → immutable published version (monthly and/or yearly
  price, seats, storage, OCR, trial and grace days, effective time). A new version applies to new
  invoices and new trials only; issued invoices and running periods keep their snapshot. Only one
  active trial plan; archive needs `plans.publish`. Shops that already pay follow the plan-change
  rules below; the same manual is shown on the plans page (collapsible guide, Thai/English).
- **Staff**: invite with a one-use 48-hour link (password + authenticator on enrolment), disable /
  enable, sign out devices, role changes and account recovery through **Approvals**. Recovery
  clears password and MFA after a second person approves; then **Create new invitation link**
  (each new link revokes the previous one).
- **Approvals**: role, recovery, plan and policy requests shown as readable details (who, which
  account, new roles, prices, policy values). For other roles the requester and approver must differ.
- **Super admin acts directly** (owner decision 2026-10-04, migration 021): has every permission;
  role / recovery / plan / policy requests apply immediately; may approve own refunds, own support
  access requests and execute closures/deletions they approved. Each such action is audited with
  `self_approved`. Still enforced: shop-owner consent for support access, holds / retention /
  unsettled-payment blocks, no disabling or recovering one's own account, last super admin kept.
- **Payments** (50 per page), proof exceptions, invoice details, refunds (two people),
  **Reconciliation**: CSV per Bangkok day and a **finance summary** (received, refunded, net, by
  confirmation channel / plan / day, unpaid invoices, pending refunds, paying shops; ≤ 366 days).
- Support tickets, owner-consented temporary data access, audit and system health.
- **Data requests** (50 per page): owner export (encrypted JSON, 24 h, owner download only),
  closure and deletion with legal holds, retention/cooling policy, unsettled-payment block and a
  second person to execute. Erasure keeps financial documents and shared user identities.
- **Operations tools**: dated backup/restore/API/storage/OCR/webhook evidence, retry failed push
  deliveries and failed OCR (quota re-reserved once; not for deleted images or shops that cannot
  write), refresh a Stripe checkout through the trusted service, outbox view.
- **Announcements and incidents**: scheduled bilingual announcements by audience (published text
  is immutable; withdraw only) and incident timelines.
- **Stripe settings**, **Platform settings** (bank, DeeSMSx, EasySlip, service on/off),
  **System policy** (new shops / new payments, retention and cooling days — two people) and
  **My account** (name, language, password, sessions).

## คู่มือ: ปรับแพ็กเกจแล้วร้านเดิมได้อะไร (Plan changes for paying shops)

กติกาแบบ C ที่เจ้าของผลิตภัณฑ์ตัดสินใจ 2026-10-08 (migration 031) ข้อความเดียวกันแสดงในหน้า **แพ็กเกจ** ของ console
(`apps/admin/app/console/plan-guide.tsx`) และในข้อตกลงการใช้งานฉบับ 1.2 — แก้ที่ใดต้องแก้ให้ตรงกันทั้งสามที่

1. **ไม่เปลี่ยนเด็ดขาด**: รอบที่จ่ายแล้วและใบแจ้งชำระที่ออกแล้ว คงราคา/สิทธิ์เดิม
2. **ได้เวอร์ชันใหม่ทันทีเมื่อถึงวันมีผล**: ร้านใหม่/ทดลองใช้ที่ซื้อครั้งแรก, ร้านที่หมดช่วงผ่อนผันแล้วซื้อใหม่, ร้านที่เปลี่ยนแพ็กเกจหรือรอบชำระ
3. **ร้านเดิมที่ต่ออายุแพ็กเกจและรอบชำระเดิม** (ยังมีวันใช้งานหรืออยู่ในช่วงผ่อนผัน ทั้งโอน/สลิปและตัดบัตร) ระบบเทียบ ราคา, จำนวนช่าง, พื้นที่รูป, วันผ่อนผัน
   - **ดีขึ้น** (ราคาไม่สูงขึ้น และอีก 3 ข้อไม่ลดลง): มีผลรอบต่ออายุถัดไป (ถ้าวันมีผลอยู่ในอนาคต นับรอบแรกที่เริ่มตั้งแต่วันนั้น) แจ้งร้าน `plan_change_better` 1 ครั้ง
   - **แย่ลงข้อใดข้อหนึ่ง** (ผสมดี/แย่ = แย่ลง): worker แจ้ง `plan_change_notice` ภายใน ~15 นาทีหลังเผยแพร่ บันทึกใน `billing.plan_change_notices`;
     วันเปลี่ยน = max(วันมีผลของเวอร์ชัน, วันแจ้ง + 30 วัน); ร้านเปลี่ยนที่รอบต่ออายุแรกที่เริ่มตั้งแต่วันนั้น ก่อนหน้านั้นต่ออายุราคาเดิมได้
   - ตัวอย่าง: ขึ้นราคา 1 พ.ย. → วันเปลี่ยน 1 ธ.ค.; ร้านครบรอบ 15 พ.ย. ต่อราคาเดิม 1 รอบ, รอบเริ่ม 15 ธ.ค. ใช้ราคาใหม่
4. **ตัดบัตร Stripe**: worker เปลี่ยนราคา subscription item เอง (product เดิม, ไม่คิดส่วนต่าง) ก่อนการตัดเงินรอบที่ถึงวันเปลี่ยน; ไม่ต้องแก้ใน Stripe Dashboard;
   ยอดราคาเก่าที่มาช้ายังจับคู่ได้; audit `subscription.stripe_price_changed`; ร้านยกเลิกได้ก่อนวันตัดเงิน
5. **ลดช่าง/พื้นที่**: ไม่ลบสมาชิกหรือรูป ต่ออายุได้ แต่เพิ่มช่าง/อัปโหลดเพิ่มไม่ได้จนกว่าจะอยู่ในเกณฑ์
6. **ก่อนกดเผยแพร่**: เวอร์ชันแก้ไม่ได้และร้านได้แจ้งเตือนทันที; ผิดให้ออกเวอร์ชันใหม่ทับ (ระบบเทียบกับเวอร์ชันล่าสุด ถ้ายังแย่กว่า นับ 30 วันใหม่);
   ใส่ราคาให้ครบทุกรอบชำระที่มีลูกค้า (ไม่มีราคารายปี = ร้านรายปีคงเวอร์ชันเดิม); การ archive ไม่ใช่การปรับราคา
7. **ร้านเห็น**: แจ้งเตือนในแอป/push และหน้าแพ็กเกจแสดง "ราคาต่ออายุของร้านคุณ" กับวันที่จะเปลี่ยน

## Setup and runtime behavior

Apply migrations **001–021** using fs_migrator (64 core/billing/platform/ops tables).
Platform functions use the separate fs_platform connection in `PLATFORM_DATABASE_URL`.
`settings.manage` belongs to super_admin/platform_admin; Stripe uses `payments.manage`.

Create the first account with `scripts/platform-account.mjs`; there is no public signup/default
admin. Production still needs HTTPS, `PLATFORM_SECRET_KEY`, authentication/storage configuration
and trusted worker connections. Infrastructure credentials remain server-only.

Saved console values override environment values, including disabled services. Before a section
is first saved, it uses the environment configuration. Blank keys keep existing credentials;
replacing DeeSMSx keys requires both keys. Keys never return to the browser or audit; only
configured status is shown. Settings apply on the next request without restarting the API.

No provider test button sends a billable message/payment. Provider verification still requires
an authorized real account. See [DEESMSX.md](DEESMSX.md), [EASYSLIP.md](EASYSLIP.md) and
[STRIPE.md](STRIPE.md). Stripe needs PAYMENT_DATABASE_URL and trusted OWNER_WEB_URL;
automatic slip confirmation needs SLIP_DATABASE_URL (both database logins must be fs_worker).

Bank changes affect new invoice snapshots. Existing invoices keep their original account.

Sensitive actions require TOTP step-up (5 minutes). Versions prevent lost updates; **Reload latest
settings** after a conflict.

### Erasure and restore

Deletion writes a tombstone and queues image keys; the worker deletes the bytes. Set
`ERASURE_REGISTRY_FILE` for the worker to a path **outside the database backup** (e.g. a separate
disk or the off-site target): the worker keeps the list of erased shops there and the file never
shrinks. After restoring any database backup, before opening the API:

```
ERASURE_REGISTRY_FILE=/srv/field-service-registry/erasure.json node --env-file=.env apps/api/dist/worker.js replay-erasure
```

This re-erases business content for every shop in the database tombstones or the registry,
recreates missing tombstones and queues the image keys again; then start the worker normally so
restored image bytes are deleted. **Download erasure ledger** in Data requests gives the same list.

OCR/Push provider integration, automatic Stripe subscriptions, Stripe API refunds/disputes/payout
sync and production deployment are not part of the console. Refund and data-request records follow
operational runbooks; they do not silently trigger provider transactions.

## Developer verification

Build the API, then `node --test --test-concurrency=1 tests/console-*.test.mjs` with mocked providers.
For PostgreSQL use guarded loopback TEST_DATABASE_URL ending in `_test`. Browser fixture:

```powershell
$env:CONSOLE_QA='1'
node --env-file=.env scripts/owner-web-test-server.mjs
```

This recreates only the isolated owner_web test database, generates synthetic console credentials
and starts API 4101 / web 3101. Real provider credentials are stripped; console/worker connections
point to the test database. Stop it when done. Do not run concurrently with PostgreSQL HTTP tests:
both temporarily change passwords on test-cluster roles.
