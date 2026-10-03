# ระบบงานบริการภาคสนาม ฐานโครงการ

โครงเริ่มต้นสำหรับ Mobile-first SaaS: Expo/React Native, Next.js, NestJS และ PostgreSQL 16 รองรับ th/en ใช้ชื่อกลาง ยังไม่ใช่แอปงานบริการพร้อมเปิดขาย

## สิ่งที่ส่งแล้ว

- `apps/mobile` แอปมือถือฐาน พร้อมเลือกภาษาและจำบนอุปกรณ์
- `apps/admin` เว็บหลังบ้านฐาน พร้อมเลือกภาษาและตรวจ API
- `apps/api` NestJS health/readiness, ข้อผิดพลาดสองภาษา และ business guard ที่ปิดการเข้าถึงจนมี verified session
- `packages/core`, `packages/i18n` code สถานะและข้อความร่วม
- `database/migrations` ตารางและ RLS หลายร้าน, composite FK, indexes และสิทธิ์แยก migration/runtime
- `database/seeds` ข้อมูลจำลอง 2 ร้าน สำหรับ local development เท่านั้น
- `tests` ทดสอบฐานข้อมูล ภาษา และข้อกำหนดสำคัญ

## เริ่มพัฒนา

ใช้ Node.js 24 LTS และ pnpm 11.25.0 ตาม `.node-version` และ lockfile

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# เปลี่ยนรหัสผ่านให้ตรงกันในตัวแปรและ connection URL
docker compose --env-file .env -f infra/compose.yaml up -d
pnpm db:migrate
pnpm db:seed
pnpm build:packages
pnpm --filter @field-service/api build
pnpm dev:api
```

เปิดอีก terminal: `pnpm dev:admin` และอีก terminal: `pnpm dev:mobile` แอปบนมือถือใช้ API host ของเครื่องพัฒนา ไม่ใช้ localhost ของโทรศัพท์ การเปิดรับ LAN ให้กำหนด HOST อย่างตั้งใจ

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm mobile:check
pnpm mobile:export
```

`/v1/health` ตรวจ process, `/v1/ready` ตรวจการต่อด้วย role fs_api และตารางพื้นฐาน Business endpoint จะตอบ 401 เสมอในฐานโครงการนี้ ห้ามเอา guard ออกหรือเชื่อ x-user-id / x-organization-id แทนการเข้าสู่ระบบ

## ฐานข้อมูลและการติดตั้ง

Docker Compose เป็นตัวเลือก local ที่เตรียมไว้ ไม่จำเป็นต้องใช้ Docker บน Ubuntu จริง PostgreSQL 16 ติดตั้งแบบ native ได้ ใช้ 00-roles.sql เป็นแนวทางเตรียม role และใช้ migration runner เดียวกัน อย่าใช้ fs_owner หรือ fs_migrator ใน API

RLS เป็นชั้นป้องกันข้อมูลข้ามร้าน Context ต้องมาจาก session ที่ยืนยันแล้วและตรวจ membership API ยังต้องตรวจ role/assignment/subscription/quota/version รายคำสั่ง สิทธิ์ช่างรายงานและระบบผู้ดูแลเต็มรูปแบบเป็นงาน A02 และ B/C ต่อไป

## สถานะการทดสอบ

ดู `docs/VERIFICATION.md` สำหรับสิ่งที่รันจริงและข้อจำกัด ไม่มีการติดตั้งบน Ubuntu หรือเชื่อมข้อมูลร้านจริง ไม่มี SMS/OCR/payment จริงในรอบนี้ ข้อมูลการเงินใน seed เป็นข้อเสนอสำหรับทดสอบ ไม่ใช่ราคาเผยแพร่
