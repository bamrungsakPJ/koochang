# Console checkpoint — 2026-10-04 (closed)

งาน "ทำ /console ให้ครบตาม MVP" ปิดแล้วในรอบนี้ รายละเอียดการใช้งานอยู่ใน [CONSOLE.md](CONSOLE.md)
ผลตรวจอยู่ใน [VERIFICATION.md](VERIFICATION.md) หัวข้อ "Console completion (017–020)"
บันทึกปัญหาและการแก้อยู่ใน [PROGRESS_LOG.md](PROGRESS_LOG.md)

## สิ่งที่ปิดจากรายการเดิม

| ข้อเดิม | ผล |
|---|---|
| 1 typecheck/build, UI อ่านง่าย ไม่ใช้ raw JSON | ผ่าน; หน้าอนุมัติแสดงรายละเอียดเป็นข้อความและบัญชีเป้าหมาย |
| 2 recovery/reinvite/ลิงก์เก่า/ผู้อนุมัติไม่ใช่ target | มีเทสต์แล้ว ผ่าน (กรณี "super admin คนสุดท้าย" ผ่าน API เกิดไม่ได้ เพราะ accounts.manage มีเฉพาะ super admin และห้ามทำกับตัวเอง) |
| 3 trial เวอร์ชันใหม่เฉพาะร้านใหม่, ตั้งเวลา, trial เดียว | มีเทสต์แล้ว ผ่าน |
| 4 OCR retry + quota, Stripe refresh | มีเทสต์แล้ว ผ่าน |
| 5 ทบทวน privacy / คอลัมน์ที่ต้องล้าง | ตรวจทุกคอลัมน์ข้อความของร้าน เพิ่มการล้าง 3 คอลัมน์ใน 020 |
| 6 restore replay | แก้ใน 020 + worker `replay-erasure` + ทะเบียนนอกฐานข้อมูล `ERASURE_REGISTRY_FILE` |
| 7 รายงานการเงิน / ภาพรวมเหตุขัดข้อง / แบ่งหน้า | ทำแล้ว (migration 020) |
| 8 PGlite + PostgreSQL 16 เต็มชุด | PGlite 137 ผ่าน 27 ข้าม; PostgreSQL 16 164/164 ผ่าน |
| 9 Next build + browser QA | ผ่าน (ข้อมูลสังเคราะห์, th/en, 320px) |
| 10 เอกสาร + commit | ทำแล้ว |

## ยังเหลือ (ไม่ใช่งานโค้ด console)

- ใส่ provider keys จริง ราคาจริง นโยบาย retention/backup จริง, HTTPS, ใช้ migration กับเครื่องจริง, UAT
- กำหนดที่เก็บ `ERASURE_REGISTRY_FILE` ให้อยู่นอก backup ของฐานข้อมูลเมื่อ deploy
- ทดสอบ OCR retry พร้อมกันหลาย request บน PostgreSQL จริง (เทสต์ตอนนี้ยิงทีละครั้ง)
- outbox ยังไม่มี consumer ทั่วไปสำหรับ replay payload (คงเดิม)
- ยังไม่ deploy/push/PR; repo ไม่มี remote
