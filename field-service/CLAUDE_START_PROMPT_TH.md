ช่วยพัฒนาระบบ Mobile-first SaaS งานบริการภาคสนามจาก repository นี้ต่อให้ใช้งานจริง โดยใช้เอกสารและโค้ดที่ส่งเป็น baseline

อ่าน CLAUDE.md, START_HERE.md, docs/IMPLEMENTATION_PLAN.md, docs/VERIFICATION.md และเอกสารล่าสุดทั้งหมดใน docs/reference ก่อนเริ่ม ดูต้นแบบ Owner/Technician และ Platform Admin ใน docs/prototypes ประกอบ อย่าถือว่า UI mock หรือมีตารางแล้วคือฟังก์ชันเสร็จ

เริ่มตรวจ baseline ของโครงการ แล้วลงมือ A02 identity/organization: Owner registration, verified session, สร้างร้าน, reusable Join Link/QR, pending/approval, team membership, role/tenant authorization และภาษา th/en เชื่อมหน้า mobile/admin กับ API จริงในขอบเขตนี้ พร้อมทดสอบกรณีข้ามร้าน ปลอมตัวตน suspended membership สมัครซ้ำ และอนุมัติพร้อมกันไม่เกินจำนวนช่าง

รักษา stack/lockfile ที่มี PostgreSQL16 บน Ubuntu24.04 เป็นเป้าหมาย แต่ยังไม่ต้อง deploy เซิร์ฟเวอร์จริง ห้ามใช้ superuser ใน API หรือถอด guard เพื่อผ่าน demo ห้ามแก้ migration ที่ใช้แล้ว ให้เพิ่มไฟล์ใหม่

GPS เฉพาะพิกัดสถานที่ลูกค้าเมื่อกดบันทึก ไม่มีติดตามช่างหรือ background/start/end GPS; Job แยก ServiceEvent/items ต่อเครื่อง; Installation/QR equipment เป็น optional; AI/OCR ห้ามบล็อก workflow; รอบดูแลแจ้ง Owner และมอบหมายช่างคนอื่นได้; สมาชิกผูก Organization; ไม่ขยายเป็น ERP

Provider ที่ยังไม่เลือกให้ใช้ interface และ development adapter ที่แยกจาก production ชัดเจน ทำส่วนที่ไม่ต้องใช้ credentials ต่อได้ อย่าฝัง OTP หรือ fake payment verification ใน production

ลงมือเขียนและตรวจโค้ดจริงเป็นช่วงตาม IMPLEMENTATION_PLAN ไม่หยุดเพียงเสนอแผน รายงานสิ่งที่ทำแล้ว วิธีรัน ผลทดสอบจริง และสิ่งที่ยังเหลือ อัปเดตเอกสารสถานะเมื่อจบแต่ละช่วง
