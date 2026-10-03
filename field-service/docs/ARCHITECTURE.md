# สถาปัตยกรรมฐานโครงการ

Mobile → HTTPS → NestJS API → PostgreSQL; Admin → HTTPS → API. รูปจริงจะอยู่ private object storage และฐานข้อมูลเก็บ reference ไม่เชื่อม PostgreSQL ตรงจาก mobile/admin

เลือก modular monolith ก่อน แยกโมดูล identity organization customers equipment jobs service maintenance billing platform และ infrastructure อยู่ repository เดียว ใช้ pnpm workspaces เลี่ยง microservices จนมีเหตุจากโหลดจริง

Node.js 24 LTS; Expo SDK 57 + React Native 0.86 + React 19.2.3; Next.js 16; NestJS 12; TypeScript 6; PostgreSQL 16. เวอร์ชัน patch ใน package.json และ pnpm-lock.yaml ตรวจ metadata ของ npm registry ณ วันที่ 2 ต.ค. 2569 ไม่ใช้ prerelease

API REST JSON UTF-8 `/v1` แยก business API จาก platform identity ในการพัฒนาต่อ Session role ร้านไม่ใช่ platform role RLS deny by default และ memberships/account ที่ suspended จะไม่มี tenant visibility

ServiceEvent เป็นหัวผลบริการจริง มี service_event_equipment หลายรายการตามเครื่องและประเภทบริการ Job เป็นแผนและการมอบหมาย ภาษาทั้งสองใช้ id และ code เดียวกัน GPS อยู่ customer_locations เท่านั้น ไม่มี technician/start/end/background GPS

ติดตั้งสภาพแวดล้อม development/staging/production แยกฐานและ secret ใช้ migration role กับ runtime role แยก ปิด PostgreSQL ต่อ internet เตรียม backup ปลายทางแยกก่อน production ห้ามใช้ seed จริงใน production

ส่วน auth SMS tenant permission รายคำสั่ง subscription entitlement การปิดงาน OCR storage notification และ platform approval ยังเป็นงานต่อจากฐานโครงการ ไม่ได้ถือว่าเสร็จจากการมีตาราง

แหล่งทางการ:
- https://docs.expo.dev/versions/latest/
- https://docs.expo.dev/guides/monorepos/
- https://nextjs.org/docs/app/getting-started/installation
- https://docs.nestjs.com/first-steps
- https://www.postgresql.org/download/linux/ubuntu/
- https://www.postgresql.org/docs/16/ddl-rowsecurity.html
