# เริ่มจากไฟล์นี้

ชุดส่งต่อให้ Claude Code ณ 3 ตุลาคม 2569 มีเอกสารรุ่นล่าสุด 5 ฉบับทั้ง DOCX และ Markdown โค้ด foundation 41 ตาราง/25 tests และต้นแบบ UI 2 ชุด

## วิธีใช้
1. แตก ZIP ไปยังโฟลเดอร์ทำงาน
2. เปิด Claude Code ที่โฟลเดอร์ field-service (ที่มี CLAUDE.md และ package.json) ไม่เปิดจากโฟลเดอร์อื่น
3. วางข้อความจาก CLAUDE_START_PROMPT_TH.md ให้ Claude Code เริ่มงาน
4. ตรวจเอกสารใน docs/reference และเปิด docs/prototypes/*.html ใน browser เพื่อดูแนวทางหน้าจอ
5. ใช้ README.md ของโครงการเพื่อเริ่ม local environment อย่าใช้ข้อมูลตัวอย่างเป็น credentials จริง

## สิ่งที่ได้รับ
- CLAUDE.md: กติกาถาวรสำหรับ coding agent
- docs/IMPLEMENTATION_PLAN.md: ลำดับงานและเกณฑ์ยอมรับ
- docs/reference: เอกสาร Product, UI/UX, Database/Backend, Commercial policy, Technical foundation ล่าสุด
- docs/prototypes: mobile Owner/Technician และ platform admin เป็น mock reference
- apps/packages/database/infra/scripts/tests: source code, migration, seeds, lockfile, CI
- docs/VERIFICATION.md: ผลตรวจจริงและข้อจำกัด

## สถานะที่ต้องเข้าใจ
มีโค้ดเริ่มต้นแล้ว แต่ยังไม่ใช่ระบบบริการพร้อมใช้งาน ไม่มี verified auth, business workflow, subscription/payment และ platform operations จริงครบ
ทดสอบ 25 ข้อผ่านบน PGlite/PostgreSQL18.3 ต้องตรวจเป้าหมาย PostgreSQL16; ยังไม่ได้ติดตั้งบน Ubuntu24.04 ยังไม่ได้ device test หรือ native APK/IPA
ไม่ต้องสร้างใหม่จากศูนย์ เริ่ม A02 identity/organization หลังตรวจ baseline และพัฒนาตามแผน ไม่มี production secrets ในชุดนี้
