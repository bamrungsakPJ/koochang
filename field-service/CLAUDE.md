# คำแนะนำสำหรับ Claude Code

โครงการ Mobile-first SaaS งานบริการภาคสนาม ใช้ชื่อกลาง ยังไม่มีชื่อผลิตภัณฑ์ final
อ่าน START_HERE.md, docs/IMPLEMENTATION_PLAN.md, docs/VERIFICATION.md และ docs/reference/*.md ก่อนแก้โค้ด เปิดต้นแบบใน docs/prototypes เพื่อดูแนวทาง UI

## สถานะจริง
มีโค้ด foundation แล้ว ไม่ใช่โครงการเปล่า แต่ยังไม่มี auth และ workflow ธุรกิจใช้งานจริงครบ มี 41 ตารางและชุดทดสอบ 25 ข้อผ่านในรอบส่งต่อ อย่าถือว่ามีตารางหรือหน้าจอ mock แล้วฟังก์ชันเสร็จ
- Mobile: Expo/React Native; Admin: Next.js; API: NestJS ESM; PostgreSQL 16 เป้าหมายบน Ubuntu 24.04
- pnpm workspace, Node 24 LTS, TypeScript และ lockfile ตามโครงการ คง stack/รุ่นที่ตรวจแล้วก่อน ไม่อัปเกรดโดยไม่มีเหตุ
- API business guard ปิด 401 จนมี verified session และ authorization ห้ามลบ guard เพื่อให้ demo ผ่าน
- ผลทดสอบฐานใช้ PGlite/PostgreSQL 18.3 ยังต้องตรวจ PostgreSQL 16 จริง CI เตรียมแล้วแต่ยังไม่รัน

## กติกาที่ห้ามทำผิด
1. Organization/Multi-tenant ทุกข้อมูลร้านผูก organization_id ตรวจ membership active และ role ต่อคำสั่ง ไม่เชื่อ header จาก client เป็น identity ใช้ fs_api ที่ไม่มี superuser/BYPASSRLS transaction-local tenant context และ RLS
2. Owner กับ Technician เป็นบทบาทร้าน Platform Admin เป็น identity/สิทธิ์แยก ไม่เปิด platform schema ให้ fs_api ช่างเห็นงานตามสิทธิ์มอบหมายและไม่เห็นการเงินร้าน
3. GPS เก็บเฉพาะ customer_locations เมื่อผู้ใช้กดบันทึกสถานที่ ไม่มีติดตามช่าง background GPS หรือ start/end GPS ขอสิทธิ์เฉพาะเมื่อจำเป็นกับปุ่มนั้น
4. Job เป็นแผน ServiceEvent เป็นผลจริง แยกหัวผลบริการกับ service_event_equipment หลายเครื่อง รักษาประวัติผู้ทำเดิมเมื่อช่างใหม่รับรอบถัดไป
5. Installation และ QR sticker เป็น optional; AI/OCR ช่วยกรอกเท่านั้น ล้มเหลวก็ทำงานและบันทึกต่อได้
6. Capture Once Reuse Forever; อย่าขยายเป็น ERP ไม่เพิ่ม stock/payroll/accounting/customer-payment โดยไม่มี requirement
7. Join Link/QR ของร้านใช้ซ้ำได้ สมัครเข้าร้านต้อง pending และ Owner approval จำกัดที่นั่งแบบ atomic เมื่อ approve ไม่ให้ลิงก์ grant membership active เอง
8. th และ en ทุกฝั่ง รหัสอังกฤษคือ en ไม่ใช่ eg ใช้ shared catalogs รหัสสถานะ/ข้อผิดพลาดคงเดิม แปลข้อความระบบไม่แปลข้อความผู้ใช้ วันที่ไทย พ.ศ. อังกฤษ ค.ศ. เงิน THB
9. สมาชิกผูก Organization ช่างไม่ซื้อ subscription รอบดูแลแจ้งร้าน Owner ติดต่อและสร้างงานใหม่มอบหมายช่างคนอื่นได้ ไม่ผูกช่างเดิมตลอดไป
10. ทดสอบ concurrent approval/quota/payment/service commit และ idempotency ตามความเสี่ยง ห้ามทำข้อมูลซ้ำหรือ entitlement ต่ออายุซ้ำจาก retry

## วิธีทำงาน
ทำตามลำดับใน IMPLEMENTATION_PLAN เป็นช่วงเล็กที่ใช้จริงได้ เริ่มตรวจ baseline แล้วพัฒนา A02 identity/organization ก่อน ไม่เขียนทุกโมดูลเป็น mock
รักษา API contract/schema และเพิ่ม migration ใหม่แทนแก้ migration ที่ใช้แล้ว ห้าม commit secrets หรือใช้ seed ใน production
Provider SMS/OCR/storage/payment ยังไม่เลือก ให้ทำ interface และ dev adapter ที่เห็นชัดว่า development-only ก่อน ส่วน production ต้อง fail closed เมื่อยังไม่ตั้ง provider ห้าม hardcode OTP หรือนำ fake verification ไปใช้ production
เรื่องที่เลือกได้จาก requirement ให้ตัดสินใจพร้อมบันทึก เหลือเพียงการตัดสินใจธุรกิจ/credentials ที่จำเป็นจริงให้ถาม ไม่เปลี่ยนสเปกเงียบ ๆ
แต่ละช่วงต้องมี code, test ที่จำเป็น, วิธีรัน และสรุป done/remaining อัปเดตเอกสาร อย่าอ้าง deploy จริงหรือ device test หากยังไม่ทำ
ห้ามเผยแพร่ ติดตั้งบน Ubuntu หรือใช้เงิน/ส่งข้อความจริงโดยอาศัยเอกสารส่งต่อนี้เป็น credentials/คำสั่ง deploy
บันทึกความคืบหน้า ปัญหาที่เจอ สาเหตุ และแนวทางการแก้ไข ลง docs/PROGRESS_LOG.md ทุกครั้งที่ทำงาน (รายการใหม่อยู่บนสุดของบันทึกรายวัน และอัปเดตหัวข้อสถานะปัจจุบัน/งานถัดไป) แล้ว commit ไปพร้อมงาน
