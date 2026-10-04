# แผนพัฒนาและเกณฑ์รับงาน

## ลำดับเอกสาร
Product/Functional และ UI/UX v1.1 กำหนด behavior; Commercial MVP v1.1 กำหนดแพ็กเกจ ภาษา และสิทธิ์สมาชิก; Database/Backend v1.1 เป็นแบบเทคนิค; Technical Foundation v1.0 และ VERIFICATION.md ระบุสิ่งที่โค้ดทำแล้วจริง
ถ้าเอกสารเดิมกับ implementation ต่าง อย่าอนุมานว่าโค้ดปัจจุบันคือ requirement ใหม่ ให้บันทึกความต่าง ตรวจเงื่อนไข และปรับอย่างมีเหตุผล
ServiceEvent ในฐานนี้เป็นหัวผลต่อ Job พร้อม items ต่อเครื่อง ห้ามแปลงเป็น Job history ที่ไม่มีผลจริงต่อเครื่อง

## A01 ตรวจฐานก่อนเปลี่ยน
ติดตั้งจาก lockfile ตรวจ typecheck/test/build แล้วรัน isolated PostgreSQL 16 tests ผ่าน TEST_DATABASE_URL ตาม guard ใน tests/database.test.mjs (loopback + ชื่อฐานจบ _test)
ตรวจ migration role/runtime role/FORCE RLS และบันทึกผลจริง ไม่ใช้ฐานร้านจริงทดสอบ เตรียม environment config และ provider interfaces

## A02 ตัวตน ร้าน และทีม — เริ่มส่วนนี้ก่อน
Owner registration สร้าง Organization และ Owner membership ผ่านธุรกรรม; session ที่ยืนยันแล้ว, logout/revoke, preference th/en ต่อบัญชี
Join Link/QR reusable + revoke/rotate + pending approval; Owner approve/reject/suspend/remove; Technician หลายร้านและเลือก context อย่างชัดเจน
ออกแบบ OTP rate limit/expiry/attempt/replay และ session expiry/refresh/revocation ใช้ dev adapter ชัดเจนจนเลือก SMS provider
เกณฑ์: ปลอม header/token ไม่ได้สิทธิ์ สมัครซ้ำไม่ซ้ำ suspend มีผลทันที อ่านข้ามร้านไม่ได้ concurrent approval ไม่เกิน seat limit Owner หลักถูกป้องกัน ผู้ดูแล platform ไม่ปน identity ร้าน

## B01 Customer / Location / Equipment
ค้นหาชื่อ/เบอร์/สถานที่/อุปกรณ์; ลูกค้าหลายสถานที่ อุปกรณ์หลายเครื่อง; optional fields progressive data
ตำแหน่ง explicit capture/manual pin พร้อม accuracy/captured_by/at/navigation; ไม่ต้องมีพิกัดก่อนสร้างงาน
Camera-first equipment image/OCR ยืนยันหรือแก้ค่าก่อน save กรอกเองได้เมื่อ OCR unavailable private image access ไม่เปิดรูปข้ามร้าน
เกณฑ์: งานลูกค้าใหม่เริ่มได้ด้วยข้อมูลน้อย นำทางพิกัดสถานที่ถูกต้อง ไม่มี background tracking บันทึกโดยไม่ใช้ OCR/QR/installation ได้

## B02 Job / Assignment / Service
สร้าง/นัด/มอบหมาย/เปลี่ยนช่าง/สถานะตาม spec; ad-hoc jobs และหลายอุปกรณ์; timezone/reschedule/conflict handling
ช่างเฉพาะงานที่มีสิทธิ์ เริ่ม/บันทึกผลรายเครื่อง ภาพ/โน้ต/ปิดงาน transactional commit, client idempotency, immutable history policy
เกณฑ์: ไม่ข้าม state ที่ผิด ไม่ปิดงานที่มีรายการไม่ครบ retry ไม่สร้าง ServiceEvent ซ้ำ version conflict ไม่ทับเงียบ ภาพ/ประวัติครบและไม่ติด GPS visit

## B03 Maintenance / Notifications
ตั้งรอบต่ออุปกรณ์/ผลบริการ สร้าง due cycle เปิดได้หนึ่งรอบ แจ้ง Owner ก่อน/ถึงกำหนด ติดตามการติดต่อ สร้าง Job ใหม่/เลื่อน/ยกเลิกพร้อมเหตุผล
notification recipient language, retry/dedup, delivery status; search/history ทุกครั้ง
เกณฑ์: ช่าง A ทำครั้งแรก รอบถัดไป Owner มอบหมายช่าง B ได้ โดยประวัติ A ไม่เปลี่ยน ไม่มีการสร้าง job ซ้ำจาก scheduler retry

## C01 Subscription และเงินของแพลตฟอร์ม
ข้อเสนอ baseline: Starter 590 THB/mo, 3 active technicians, 10 GB, OCR100/cycle; Team1290, 10 technicians,30GB,OCR300; trial14วัน 3tech1GB OCR20; paid renewal grace7วัน
Owner หลักไม่กิน seat ช่าง; pending/suspended/removed ไม่นับ; จำกัดการอนุมัติและ reserve/release storage/OCR แบบ atomic
ตามคำสั่งผู้ใช้ 2026-10-04 ใช้ EasySlip ตรวจทันที: ตรวจผ่านแล้วบันทึกการชำระและเปิดสิทธิ์อัตโนมัติใน transaction เดียว; เฉพาะรายการมีปัญหาให้ admin ตรวจยอดจริงต่อ การอัปโหลดอย่างเดียวไม่เปิดสิทธิ์ ดู EASYSLIP.md
กัน duplicate reference/idempotency, refund sum และ separation requester/approver; price version history; ดำเนินงานที่เริ่มแล้วตาม baseline ห้ามบล็อกทุกอย่างแบบกว้างโดยไม่อ่าน policy
เกณฑ์: จ่ายซ้ำ/approve ซ้ำไม่เพิ่มรอบซ้ำ concurrent quota ไม่เกิน ไม่เผยข้อมูลการเงินให้ช่าง ราคายังเป็นข้อเสนอทดสอบ ไม่ใช่ราคาเผยแพร่

## C02 Platform Admin
login/roles ผู้ดูแล แสดงร้าน/team/subscriptions/payment/usage/audit; 7 role codes ตาม database/spec ไม่ทำ superadmin ครอบทุกหน้าด้วย client hiding
support access มี ticket, consent, approval, expiry <=60min, audit; data export/deletion/retention ตาม spec
เกณฑ์: least privilege ต่อคำสั่ง ข้อมูลร้านเข้าช่วยเฉพาะสิทธิ์ที่อนุมัติ ผู้ขอ/ผู้อนุมัติคืนเงินแยก ตรวจย้อนหลังได้

## D ก่อนทดลองร้านจริง
end-to-end ไทย/อังกฤษ Ownerสมัคร→สร้างร้าน→Join/approve→ลูกค้าไม่มีพิกัด→Jobหลายเครื่อง→ช่างบันทึกสถานที่→ผล/ภาพ→ปิด→Maintenance due→แจ้งOwner→Jobใหม่ช่างอีกคน→subscription/renewal→platform support/audit
PostgreSQL16 native, physical Android/iOS, permission denied/offline/retry, private media, backup+restore, security/tenant/role/concurrency checks และ staging
ตัวชี้วัด: เวลาปิดบันทึกหน้างาน ความครบประวัติต่อเครื่อง อัตรานัดซ้ำจากรอบดูแล active shops/technicians retention trial conversion และต้นทุนต่อร้าน/OCR/storage
MVP ไม่รวม ERP inventory/payroll/accounting, live technician tracking, forced installation/QR, mandatory AI, customer CRM เต็มรูปแบบ หรือ LINE OA จริง (future)

## Definition of Done ต่อช่วง
หน้าจอจริง th/en + API + schema/migration + validation/permissions + critical tests + วิธีทดลอง + docs/status ที่ตรงโค้ด ไม่ยอมรับเฉพาะ mock screens หรือฐานตารางเป็นงานครบ
