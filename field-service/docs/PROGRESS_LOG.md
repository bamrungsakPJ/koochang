# บันทึกความคืบหน้า (Progress log)

ไฟล์นี้บันทึก **ความคืบหน้า ปัญหาที่เจอ และแนวทางการแก้ไข** ทุกครั้งที่ทำงาน
เขียนรายการใหม่ไว้บนสุดของหัวข้อ "บันทึกรายวัน" ใช้รูปแบบเดิม: ทำอะไร → ปัญหา → สาเหตุ → แก้อย่างไร → สถานะ
รายละเอียดการทดสอบอยู่ใน [VERIFICATION.md](VERIFICATION.md) เหตุผลการออกแบบอยู่ใน `DECISIONS_*.md`
สิ่งที่ต้องตัดสินใจก่อน pilot อยู่ใน [PILOT_RUNBOOK.md](PILOT_RUNBOOK.md)

---

## สถานะปัจจุบัน (อัปเดตล่าสุด 2026-10-05 — ตั้งชื่อ คู่ช่าง / KooChang)

- **ชุดโลโก้ KooChang v1 (2026-10-05)**: สร้าง PNG โลโก้เว็บพื้นโปร่งใส ไอคอนแอปพื้นทึบ และภาพหน้าเปิดแอปไว้ใน `output/branding/koochang-v1/` พร้อม README; ตรวจภาพแล้ว เป็นชุดแบบออกแบบ ยังไม่ได้แทนไฟล์ในแอป/เว็บหรือ deploy ต้องเตรียมขนาดเฉพาะแพลตฟอร์มและตรวจบนอุปกรณ์ก่อนใช้จริง

**เริ่มต่อจากตรงนี้**
- โค้ดทั้งหมดอยู่ branch `field-service-a02` (ล่าสุด commit Push FCM, migration 024) **ยังไม่ได้ push — ไม่มี git remote**
- **Staging บน server2** อัปเดตถึง c24a60e (2026-10-05): console https://app-staging.koochang.com/console, เว็บร้าน https://app-staging.koochang.com/shop, API https://api-staging.koochang.com (ผ่าน Cloudflare Tunnel, HTTPS ใช้ได้แล้ว; LAN 192.168.1.127 ปิดแล้ว) — โหมด development (OTP ดูจาก `pm2 logs fs-staging-api`), ฐานข้อมูล 16/staging พอร์ต 5434 migration ถึง 024, มีบัญชี console 1 คน, แพ็กเกจเปิดตัว 4 แบบ active วิธีอัปเดตใน [DEPLOY_SERVER2.md](DEPLOY_SERVER2.md)
- **เครื่อง dev**: API :4000, console/เว็บร้าน :3001, ฐานข้อมูล dev (server2 16/main) migration ถึง 024; มีร้านทดลอง "ร้านทดสอบดีไซน์" เบอร์ทดลอง 0800009876; บัญชี console ทดลองอยู่ใน `.dev-platform-accounts.txt` (ไม่อยู่ใน git)
- **การตัดสินใจล่าสุด**: super admin ทำทุกอย่างได้เองไม่ต้องมีผู้อนุมัติ (migration 021; บทบาทอื่นยังใช้สองคน); console และเว็บร้านใช้ดีไซน์ SaaS สว่างชุดเดียวกัน
- **ขั้นต่อไปของผู้ใช้**: สร้างแพ็กเกจ trial + รายเดือนใน console staging (super admin กดเผยแพร่ได้ทันที), ลองใช้ดีไซน์ใหม่แล้วให้ความเห็น
- **Push**: เลือก FCM โดยตรง เริ่มที่ Android (2026-10-05) โค้ดพร้อม ดู [PUSH_FCM.md](PUSH_FCM.md)
- **ชื่อผลิตภัณฑ์**: **คู่ช่าง** (ไทย) / **KooChang** (อังกฤษ); package/bundle id `com.koochang.app`; deep link `koochang://`
- **ยังไม่มี**: โดเมน (แนะนำ koochang.com หรือ .co.th), โปรเจกต์ Firebase, DeeSMSx key, EasySlip/Stripe key, ANTHROPIC_API_KEY

**สรุปสิ่งที่ทำเสร็จ**
- Console `/console` ครบตาม MVP (migration 017–020) + ดีไซน์ใหม่; เว็บเจ้าของร้าน `/shop`; แอปมือถือ (Expo); ชำระเงิน EasySlip/Stripe; OTP DeeSMSx; OCR ป้ายเครื่องด้วย Claude API ([OCR_CLAUDE.md](OCR_CLAUDE.md))
- ผลตรวจล่าสุด: PostgreSQL 16 170/170 ผ่าน; PGlite 142 ผ่าน 27 ข้าม 0 ล้มเหลว; typecheck + Next production build ผ่าน

- Branch `field-service-a02` — พัฒนาฟังก์ชัน A01 → D ฝั่ง API/mobile/platform console แล้ว และรอบนี้เพิ่มเว็บเจ้าของร้านโดยเฉพาะที่ `/shop`; การยืนยันบนอุปกรณ์จริงและ production providers ยังไม่ครบ
- เว็บเจ้าของร้าน MVP ครอบคลุมภาพรวมร้าน ทีม ลูกค้า/สถานที่/พิกัด อุปกรณ์/OCR งาน/ผลบริการ/ร่าง รอบดูแล สมาชิก/สลิป ซัพพอร์ต และบัญชี ไทย/อังกฤษ ดู [OWNER_WEB.md](OWNER_WEB.md)
- เพิ่มแบ่งหน้าลูกค้าและงานครั้งละ 50 รายการแล้ว อ่านต่อได้เกินขีดจำกัด 100/200 เดิม พร้อมคงคำค้น/ตัวกรองและตรวจ RLS ทุกหน้า
- ใช้ EasySlip v2 ตรวจทันทีหลังอัปโหลด: ผ่านแล้วบันทึกยอด/ใบแจ้งชำระ/รอบสมาชิกและเปิดสิทธิ์อัตโนมัติ เฉพาะรายการมีปัญหาเข้าคิวแอดมิน เว็บร้าน/มือถือ/console แสดงผลไทยและอังกฤษแล้ว ดู [EASYSLIP.md](EASYSLIP.md); ยังไม่ตั้งค่าหรือทดสอบกับบริการและเงินโอนจริง
- เพิ่มการตั้งค่าบัญชี Stripe ใน console และเลือก QR PromptPay/บัตรเครดิตบนเว็บร้านกับมือถือแล้ว ยืนยันยอดจาก Stripe ฝั่ง server ก่อนเปิดสิทธิ์ทันที เก็บ EasySlip เป็นอีกช่องทาง ดู [STRIPE.md](STRIPE.md); ยังไม่ได้เชื่อมบัญชีจริงหรือเปิดรับเงินจริง
- เลือกและเพิ่ม DeeSMSx ส่ง OTP ไทย/อังกฤษแล้ว เก็บ keys เฉพาะ server และปิดการขอ OTP หากตั้งค่าไม่ครบ ดู [DEESMSX.md](DEESMSX.md); ยังไม่ได้ใส่บัญชีจริงหรือส่ง SMS จริง
- `/console` เพิ่มตั้งค่าบัญชีรับเงิน DeeSMSx/EasySlip เปิด/ปิดบริการ และบัญชีผู้ดูแลส่วนตัว (ชื่อ ภาษา รหัสผ่าน อุปกรณ์ ออกจากเครื่องอื่น) แล้ว พร้อมปรับ Stripe webhook เป็น URL เต็ม; ค่าที่บันทึกมีผลทันทีและกุญแจเข้ารหัส ดู [CONSOLE.md](CONSOLE.md)
- ผู้ใช้แจ้งว่ายังไม่พร้อมทดสอบ จึงเลื่อน UAT/การตรวจมือถือจริงไว้ และให้ทำเว็บเจ้าของร้านก่อน การตรวจรอบนี้ทำโดยผู้พัฒนาด้วยข้อมูลสังเคราะห์ในฐานทดสอบแยก
- **ยังไม่ได้ push**: repo ยังไม่มี git remote และเครื่องไม่มี `gh` → รอ URL ของ repo
- รอบก่อนเริ่มทดสอบบน Android จริงผ่าน Expo Go (LAN, PC = 192.168.1.99); รอบนี้ยังไม่ได้ควบคุมหรือยืนยันผลบนมือถือจริง
- เพิ่มข้อความบัญชีที่กำลังใช้บนหน้าลิงก์เข้าร่วม และปุ่มออกจากระบบเพื่อใช้เบอร์อื่น โดยกลับมาลิงก์ร้านเดิม (th/en)

### งานที่เหลือทั้งหมด (สรุป 2026-10-04 หลังติดตั้ง staging บน server2)

งานโค้ดครบแล้ว (แอปมือถือ, เว็บเจ้าของร้าน, console, OCR ด้วย Claude) และ **staging บน server2 ติดตั้งแล้ว** ใช้ได้ใน LAN ที่ http://192.168.1.127:3200/console (ดู [DEPLOY_SERVER2.md](DEPLOY_SERVER2.md)) ที่เหลือคือการตัดสินใจ การตั้งค่าบริการจริง และการทดสอบ

**A. ทำต่อบน staging ได้ทันที**
1. (ทำแล้ว 1 คน) บัญชี console เพิ่มเติมสร้างได้ด้วย `scripts/platform-account.mjs create` บน server2 — super admin คนเดียวพอ ไม่ต้องมีผู้อนุมัติแล้ว
2. สร้างแพ็กเกจทดลองใช้ + แพ็กเกจรายเดือน/รายปีใน console (super admin เผยแพร่ได้ทันที) (ตอนนี้ไม่มีแพ็กเกจ ร้านใหม่จะติด "รอชำระเงิน")
3. ตั้งค่านโยบายระบบ: จำนวนวัน retention และ cooling ก่อนลบข้อมูลร้าน
4. ชี้แอปมือถือไปที่ staging (`EXPO_PUBLIC_API_URL=https://api-staging.koochang.com`) แล้วทดสอบบนมือถือจริง

**B. ต้องให้ผู้ใช้/ฝ่ายธุรกิจตัดสินใจหรือให้ข้อมูล**
1. ~~ชื่อระบบ/ผลิตภัณฑ์~~ ✅ คู่ช่าง / KooChang (2026-10-05)
2. **โดเมน** (จดใน Cloudflare) → เปิด staging ผ่าน Cloudflare Tunnel เป็น HTTPS
3. URL ของ git repo → push branch `field-service-a02`, เปิด PR, ใช้ git แทน bundle ในการอัปเดต server
4. บัญชี DeeSMSx จริง — จำเป็นก่อนสลับเป็นโหมด production และก่อนให้ร้านจริงเข้าสู่ระบบ
5. บัญชีธนาคารรับเงิน + EasySlip key และ/หรือบัญชี Stripe (test mode ก่อน live)
6. `ANTHROPIC_API_KEY` สำหรับ OCR และยืนยันโมเดล/งบหลังวัดผลกับรูปจริง ([OCR_CLAUDE.md](OCR_CLAUDE.md))
7. ราคาจริงของแพ็กเกจและจำนวนวันทดลองใช้ (ราคาเสนอเดิม Starter 590 / Team 1,290 บาท/เดือน)
8. รูปแบบใบเสร็จ/ใบกำกับภาษี
9. ~~ผู้ให้บริการ Push~~ ✅ เลือก FCM เริ่ม Android (2026-10-05), package `com.koochang.app` — ที่เหลือ: โปรเจกต์ Firebase (`google-services.json` และ service account key) ดู [PUSH_FCM.md](PUSH_FCM.md)
10. ข้อความนโยบายความเป็นส่วนตัวสำหรับร้าน (รวมเรื่องรูปป้ายเครื่องถูกส่งให้ AI อ่าน)
11. ปลายทาง backup นอกเครื่อง (ตอนนี้สำรองไว้ดิสก์ /data3 ในเครื่องเดียวกัน)

**C. งานติดตั้ง/ตั้งค่าหลังได้ข้อมูลจากข้อ B**
1. ใส่ hostname ใน Cloudflare Tunnel, ตั้ง `HOST=127.0.0.1` และ origin แบบ https, build เว็บใหม่ด้วย API URL แบบ https
2. ใส่ key ของ DeeSMSx / EasySlip / Stripe / Anthropic ใน env หรือหน้า console แล้วสลับ `NODE_ENV=production`
3. เมื่อพร้อมเปิดร้านจริง: แยก production (cluster ใหม่หรือเครื่องใหม่) ตาม PILOT_RUNBOOK; ตั้ง `OFFSITE_TARGET` จริง

**D. การทดสอบที่ยังไม่ได้ทำ**
1. มือถือจริง Android/iOS: ช่างเข้าร่วมร้านด้วยเบอร์อื่น + อนุมัติ, ขอบจอ Android หลังแก้ safe-area, กล้อง/แกลเลอรี, GPS, ร่างออฟไลน์, session หลังรีสตาร์ท API, push
2. UAT เว็บเจ้าของร้าน `/shop` และ console บน staging
3. ทดสอบกับบริการจริงเมื่อได้รับอนุญาต: OTP จริง, โอนเงิน + EasySlip, Stripe test mode
4. วัดความแม่นและค่าใช้จ่าย OCR ด้วยรูปป้ายจริง 20–30 รูป (ต้องมี key และอนุญาตก่อนเรียก API จริง)
5. OCR retry หลายคำขอพร้อมกันบน PostgreSQL จริง
6. สร้าง APK/IPA จริง (ยังใช้ Expo Go/web) — จำเป็นสำหรับทดสอบ push เพราะ Expo Go รับ push ไม่ได้

**E. ปรับปรุงที่ควรทำภายหลัง (ไม่บล็อก pilot)**
1. ~~สรุปการเงินนับ "ร้านที่ชำระเงิน" ช้า~~ ✅ แก้แล้ว (migration 022)
2. ข้อความเมื่อผู้ใช้ที่ล็อกอินอยู่เปิดลิงก์เข้าร่วมร้าน — ตรวจบนมือถือ
3. outbox ยังไม่มี consumer — Push ไม่ได้ใช้ outbox (ใช้คิว `ops.notification_deliveries` ที่มีอยู่แล้ว) จึงยังไม่จำเป็น
4. รัน GitHub CI (PostgreSQL 16) เมื่อมี remote
5. โปรเจกต์ ServiceFlow เดิมอยู่ในโฟลเดอร์แม่ทำให้ dependency ที่ไม่ได้ประกาศผ่านบนเครื่อง dev — ควรตรวจ build ใน CI/เครื่องสะอาดทุกครั้ง

---

## ภาพรวมขั้นงานที่เสร็จแล้ว

| วันที่ | Commit | ขั้น | สรุป |
|---|---|---|---|
| 2026-10-03 | a56e7f3 | A01–A02 | baseline + เข้าสู่ระบบด้วยเบอร์โทร + OTP (ไม่ใช้อีเมล), สร้างร้าน, ลิงก์/QR เข้าร่วม, ช่าง pending จนเจ้าของอนุมัติ |
| 2026-10-03 | 62a9366 | UI | ธีมน้ำเงิน, Noto Sans Thai, ไอคอน, แถบเมนูล่าง |
| 2026-10-03 | c49449e | A03 | แพ็กเกจสมาชิก (trial / active / past_due / expired ฯลฯ), การ์ดแผน |
| 2026-10-03 | 49bfdaf | A04 | ไฟล์/รูป, คิว OCR, การแจ้งเตือน, worker |
| 2026-10-04 | aa4ab0f | B01–B03 | ลูกค้า, อุปกรณ์ (OCR ป้ายเครื่อง, ตรวจ serial ซ้ำ), งาน |
| 2026-10-04 | 7c423f4 | B04 | บันทึกงานบริการและปิดงาน |
| 2026-10-04 | 8681d55 | B05 | รอบบำรุงรักษาและการเตือน |
| 2026-10-04 | d07b4ef | C01 | ชำระเงินโอน + สลิป, console ยืนยันยอด (รหัส + TOTP), คืนเงินสองคน |
| 2026-10-04 | a430713 | C02 | ผู้ดูแลแพลตฟอร์ม: ระงับร้าน, ซัพพอร์ต, ขอสิทธิ์ดูข้อมูลโดยเจ้าของยินยอม, audit |
| 2026-10-04 | 08e6b71 | D | เตรียม pilot: ตรวจ config, ร่างออฟไลน์, ตัวชี้วัด, backup/restore, runbook |
| 2026-10-04 | 7a0a1ff, f53dc55, 7640470 | ทดสอบมือถือ | แก้ลิงก์เข้าร่วม, ขอบจอ Android (ดูด้านล่าง) |
| 2026-10-04 | eea18fc … a4a55fd | เว็บร้าน + ชำระเงิน | `/shop`, EasySlip, Stripe, DeeSMSx, ตั้งค่า console |
| 2026-10-04 | commit "Console completion" | Console | migration 017–020: ทีมผู้ดูแล, แพ็กเกจ, อนุมัติ, นโยบาย, ประกาศ/เหตุขัดข้อง, คิว, privacy, รายงานการเงิน, แบ่งหน้า |

---

## บันทึกรายวัน

### 2026-10-05 — เทียบสีและรูปแบบตัวอักษรโลโก้ KooChang v2

- ทำอะไร: ผู้ใช้ขอปรับสีและตั้งข้อสังเกตเรื่องตัวอักษร จึงสร้างภาพเทียบ 3 แนว A น้ำเงินกรมท่า/ฟ้า, B เขียวเข้ม/ทองนวล ตัวพิมพ์เล็ก, C ม่วงเข้ม/ม่วงอ่อน ตัวอักษรแนวเทค ใน `output/branding/koochang-v2/`
- ปัญหา/สาเหตุ: แบบ v1 สีและตัวอักษรยังไม่ตรงความชอบของผู้ใช้; A ในภาพ v2 ยังมีน้ำหนักตัวอักษรหนา จึงยังเป็นแบบเทียบ ไม่ใช่ wordmark สุดท้าย
- แก้อย่างไร: เก็บสัญลักษณ์เดิมเพื่อเทียบความต่างของสีและตัวอักษรได้ชัด; บันทึกข้อจำกัดและตัวเลือกใน README
- สถานะ: ตรวจภาพแล้ว รอเลือกแนวและปรับเป็นไฟล์แยก ยังไม่ได้เปลี่ยนเว็บ/แอปหรือ deploy


### 2026-10-05 — ออกแบบชุดโลโก้ KooChang v1 สำหรับเว็บ แอป และหน้าเปิดแอป

- ทำอะไร: ใช้ imagegen สร้างโลโก้แนวนอนพื้นโปร่งใส ไอคอนสี่เหลี่ยม และภาพเปิดแอปแนวตั้ง เก็บไฟล์ PNG กับคำแนะนำใน `output/branding/koochang-v1/`
- แนวคิด: รูปทรงสองส่วนสีเขียวอมฟ้า/ส้มประกอบเป็น K และช่องว่างปากประแจ สื่อถึงคู่หูร้านกับช่าง; หน้าตอนเปิดแอปมีชื่อ KooChang และ คู่ช่าง
- ปัญหา/ข้อจำกัด: ภาพที่สร้างเป็น raster และรูปทรงระหว่างแต่ละภาพอาจมีความต่างเล็กน้อย ยังไม่ใช่ vector master หรือชุด adaptive icon ที่ส่งขึ้นสโตร์ได้ทันที
- แก้อย่างไร: เก็บแบบเป็น v1 แยกจากไฟล์แอปเดิม ตรวจชื่อและองค์ประกอบจากภาพทั้งสาม พร้อมบันทึกงานต่อเรื่อง vector, ขนาดตามแพลตฟอร์ม และการทดสอบอุปกรณ์ใน README
- สถานะ: ได้ชุดแบบและไฟล์ภาพแล้ว ยังไม่ได้เปลี่ยนหน้าจอจริง ไม่ได้ทำ animation และไม่ได้ deploy


### 2026-10-05 — ไอคอนแอปและหน้าโหลด (splash) คู่ช่าง

- ผู้ใช้แจ้ง: ติดตั้ง APK ได้แล้ว แต่เปิดแอปไม่มีหน้าโหลดหรือโลโก้ (เข้าหน้าโปรแกรมทันที) และไอคอนเป็นหุ่นเขียวของ Android; ถามว่าเปลี่ยนไอคอนได้ไหม
- สาเหตุ: app.json ไม่มี icon / adaptiveIcon / splash เลย
- ทำอะไร: `scripts/make-app-icons.mjs` สร้างรูปจากเครื่องหมายเดียวกับ favicon เว็บ (กล่องน้ำเงิน + ประแจขาว): icon.png 1024, adaptive icon (พื้นหลัง gradient + ประแจในพื้นที่ปลอดภัย 66%), monochrome สำหรับ themed icon ของ Android 13+, splash-icon, favicon เว็บ; ใช้ `expo-splash-screen` พื้นขาว (โหมดมืด #0f172a) และค้าง splash จนฟอนต์และ session โหลดเสร็จ
- ข้อจำกัด: ไอคอนแอปและ splash ฝังในตัวแอปตอน build เปลี่ยนจากโลโก้ใน console ไม่ได้ ต้อง build ใหม่
- ตรวจแล้ว: typecheck ผ่าน, `expo config` เห็นค่าใหม่, `expo export --platform android` ผ่าน, ดูภาพตัวอย่างไอคอนแล้ว
- สถานะ: ⏳ ผู้ใช้ขอยังไม่ build — ไอคอน/splash จะเห็นใน APK รอบถัดไป

### 2026-10-05 — เตรียม build APK สำหรับทดสอบ (EAS Build)

- ผู้ใช้ขอไฟล์ APK เพื่อติดตั้งทดสอบ
- ตรวจเครื่อง dev: build เองไม่สะดวก — Java ที่มากับ Android Studio (`jbr`) ไม่มี `java.exe`, ไม่มี NDK/CMake, ไดรฟ์ D: เหลือ 5 GB (98%)
- ทำอะไร: เพิ่ม `apps/mobile/eas.json` โปรไฟล์ `staging-apk` (APK สำหรับแจกภายใน เรียก `https://api-staging.koochang.com`) และ `production` (AAB สำหรับ Play Store)
- ผู้ใช้ล็อกอิน Expo (บัญชี bamrungsak_pj) และ build ครั้งแรกเอง: สร้างโปรเจกต์ EAS `koochang` (projectId ใน app.json) และ keystore เก็บบน Expo
- ปัญหา: build แรกล้มที่ "Bundle JavaScript" (`expo export:embed` exit 1) — `packages/*/dist` อยู่ใน .gitignore จึงไม่ถูกอัปโหลด แอปหา `@field-service/core`/`i18n` ไม่เจอ (เครื่อง dev ผ่านเพราะมี dist อยู่แล้ว)
- แก้: script `eas-build-post-install` ใน apps/mobile สั่ง `pnpm build:packages`; ทดสอบโดยลบ dist แล้วรัน script สร้างกลับครบ
- ผล: build ที่ 2 (2dd54adf) สำเร็จ ได้ APK staging (รอคิวประมาณ 50 นาทีบนบัญชีฟรี)
- ข้อสังเกต: archive ใหญ่ 254 MB เพราะ EAS อัปโหลดทั้ง git repo (รวม ServiceFlow เดิม) ควรเพิ่ม .easignore
- ติดตั้งบนมือถือจริง: Google Play Protect บล็อก ("ไม่เคยเห็นแอปจากนักพัฒนารายนี้") เพราะ APK ไม่ได้มาจาก Play Store; ทางเลี่ยงช่วงทดสอบ: "ติดตั้งต่อไป" ในรายละเอียด / ปิดสแกนชั่วคราว / ติดตั้งผ่าน ADB
- Google Play Console: ผู้ใช้กำลังขอเลข D-U-N-S เพื่อเปิดบัญชีแบบบริษัท (2026-10-05) → หลังได้บัญชีจะแจกทดสอบผ่าน Internal testing
- สถานะ: ✅ มี APK; ⏳ ทดสอบบนมือถือจริง; push ใช้ได้เมื่อมี `google-services.json` (ไฟล์อยู่นอก git ต้องอัปโหลดเป็น EAS file variable `GOOGLE_SERVICES_JSON`)

### 2026-10-05 — แจ้งผล "บันทึกสำเร็จ / ไม่สำเร็จ" ด้วย toast (console + เว็บร้าน)

- ผู้ใช้แจ้ง: บันทึกข้อมูลแต่ละครั้งไม่มีข้อความบอกสถานะ ต้องการ toast
- ทำอะไร: `app/toast.tsx` (Toaster ใน root layout มุมขวาล่าง, มือถือเต็มความกว้าง) ผูกกับ API client ทั้งสองฝั่ง ทุกคำสั่งสร้าง/แก้/ลบจึงแสดง "บันทึกสำเร็จ" (หายใน 3 วิ) หรือ "บันทึกไม่สำเร็จ" พร้อมเหตุผล (6 วิ) โดยไม่ต้องแก้ทีละฟอร์ม; ข้อความ th/en อยู่ใน shared catalog (`toastSaved`, `toastFailed`, `toastClose`)
  - ไม่แสดง: การอ่านข้อมูล, ขั้นตอนเข้าสู่ระบบ/OTP/refresh/logout, step-up (จะลองใหม่หลังกรอกรหัส), อ่านแจ้งเตือนแล้ว, ขั้นย่อยอัปโหลดรูป/OCR, ตรวจสถานะ checkout, คำเตือนข้อมูลซ้ำ (เป็นคำถามให้ผู้ใช้เลือก ไม่ใช่ล้มเหลว)
  - หลายคำขอจากการกดครั้งเดียวรวมเป็น toast เดียว และ "ไม่สำเร็จ" ไม่ถูก "สำเร็จ" ที่ตามมาทับ
- ปัญหา: test เว็บร้านโหลด `shop/api.ts` แบบ data URL ที่ import ได้เฉพาะไฟล์ข้างเคียง → การ import toast/i18n ใน api.ts ทำให้ test ล้ม แก้โดยให้ api.ts มี hook `onSave` แล้ว OwnerApp เป็นคนผูกกับ toast
- ตรวจแล้ว: test ใหม่ใน owner-web (สำเร็จ/ล้มเหลว/ไม่แสดงในกรณียกเว้น) ผ่าน; PGlite 157 ผ่าน / 27 ข้าม / 0 ล้มเหลว; typecheck + next build ผ่าน; ยังไม่ได้เปิดดูบนจอเพราะ dev server ครบโควตา (ของแชตอื่น 4 ตัว) และ staging ต้องเข้าสู่ระบบก่อนจึงจะกดบันทึกได้
- ยังไม่ทำ: แอปมือถือ (ใช้ Banner แจ้งผลในหน้าจออยู่แล้ว)

### 2026-10-05 — super admin เปลี่ยนโลโก้และ favicon ได้ (migration 025)

- ทำอะไร: เมนู console ใหม่ "โลโก้และไอคอน" (สิทธิ์ `branding.manage` เฉพาะ super_admin) อัปโหลดโลโก้และ favicon แยกกัน; ถ้าไม่อัปโหลด favicon แยก ระบบสร้างจากโลโก้ให้ (64×64); รีเซ็ตกลับค่าเดิมได้; ทุกการแก้บันทึก audit `branding.updated` และกันแก้ทับกันด้วย version
  - API: `GET /v1/branding` (สาธารณะ), `GET /v1/branding/logo.png|favicon.png` (ใส่ `?v=` แล้ว cache ยาว), `POST /v1/platform/branding/{logo|favicon}?version=` (ส่งไฟล์ดิบ), `POST /v1/platform/branding/reset`
  - ความปลอดภัย: รับเฉพาะ PNG/JPEG/WebP ≤ 5 MB ไม่รับ SVG (อาจมี script); ทุกรูปถูก re-encode ด้วย sharp เป็น PNG (โลโก้ ≤ 512 px) ตัด metadata; ตอบด้วย `Content-Security-Policy: default-src 'none'`
  - เว็บ: console, เว็บร้าน `/shop` และหน้าเข้าร่วมร้านแสดงโลโก้แทนไอคอนเดิม; favicon ของแท็บเบราว์เซอร์เปลี่ยนตาม (ค่าเริ่มต้นใหม่ `public/icon.svg` (ไม่ใช้ `app/icon.svg` เพราะ Next จะใส่ link icon ของตัวเองซ้อนและชนะ favicon ที่อัปโหลด) เพราะเดิมไม่มี favicon เลย); มือถือ: หน้าต้อนรับแสดงโลโก้ (ไอคอนแอปบนหน้าจอโทรศัพท์เปลี่ยนแบบนี้ไม่ได้ ต้อง build แอปใหม่)
- ปัญหา: (1) route `POST :kind` ประกาศก่อน `reset` จะรับ `/reset` ไปเป็นชนิดรูป → ย้าย `reset` ขึ้นก่อน (2) `pnpm db:migrate` บนฐาน dev ล้มเพราะ checksum ของ 024 ไม่ตรง: ลง 024 ตอนไฟล์ยังเป็น CRLF แล้วค่อยแปลงเป็น LF ก่อน commit (เนื้อหาเหมือนเดิม) → แก้ checksum ใน `migration.history` ของฐาน dev ให้ตรงไฟล์ที่ commit; staging ใช้ไฟล์ LF อยู่แล้วไม่กระทบ (3) เปิด web dev server แยกไม่ได้เพราะครบ 5 server ต่อโฟลเดอร์ (อีก 4 ตัวเป็นของแชตอื่น) จึงตรวจ API จริงด้วย curl และหน้าเว็บด้วย build
- ตรวจแล้ว: `tests/branding.test.mjs` 6 ข้อ (สิทธิ์, re-encode/ขนาด, cache header, SVG/ไฟล์เสียถูกปฏิเสธ, version conflict, favicon แยกไม่ถูกทับ, reset, fs_api เข้าไม่ได้); PGlite ผ่านทั้งหมด; typecheck ทุก workspace + `next build` ผ่าน; API จริงบนฐาน dev ตอบ `/v1/branding` 200, รูปที่ยังไม่ตั้ง 404, อัปโหลดไม่มี session 401
- สถานะ: ✅ โค้ด; ⏳ deploy staging

### 2026-10-05 — อัปเดต staging บน server2 + เตรียมเปิดผ่าน Cloudflare Tunnel (คู่ช่าง)

- ผู้ใช้ตั้ง hostname ใน tunnel แล้ว: `app-staging.koochang.com` → `http://localhost:3200`, `api-staging.koochang.com` → `http://localhost:4100`
- ทำแล้วบน server2: ส่ง bundle (คัดลอกผ่านได้รอบนี้) → โค้ด c24a60e, `pnpm install --frozen-lockfile`, build เว็บด้วย `NEXT_PUBLIC_API_URL=https://api-staging.koochang.com`, migration 022–024, `launch-plans.sql` (trial, solo, small_team, business active)
- ปัญหา: (1) HTTPS ของทั้งสอง hostname ล้มที่ Cloudflare edge (TLS alert 40 handshake failure) ทั้งจาก PC และจาก server2 → ใบรับรอง Universal SSL ของ koochang.com ยังไม่ออก/โดเมนยังไม่ active (2) บริการ staging ฟังเฉพาะ 192.168.1.127 (`HOST` และ `next start -H 192.168.1.127`) ทำให้ tunnel ที่ชี้ localhost จะได้ 502 (3) ระบบสิทธิ์ของ Claude บล็อกการแก้ `/etc/field-service/staging.env` ด้วย sudo
- แก้อย่างไร (3): ผู้ใช้สั่งให้รันเองในแชต จึงสำรอง `staging.env.bak-20261005` แล้วตั้ง HOST=127.0.0.1 และ ADMIN_ORIGIN/OWNER_WEB_URL/JOIN_LINK_BASE_URL เป็น https://app-staging.koochang.com; สร้าง fs-staging-web ใหม่ด้วย `-H 127.0.0.1`; restart api/worker; `pm2 save`
- ตรวจแล้ว: บนเครื่อง API `/v1/ready` 200, `/console` 200, `/shop` 200 ทั้งหมดฟังที่ 127.0.0.1; CORS ตอบ `Access-Control-Allow-Origin: https://app-staging.koochang.com`; worker เริ่มด้วย push=development
- อัปเดต: ผู้ใช้แจ้งว่า SSL ใช้ได้แล้ว → ตรวจจากภายนอก: API `/v1/ready` 200, `/console` 200, `/shop` 200, `/join/…` 200; CORS preflight 204 พร้อม allow-origin ถูกต้อง; เปิดในเบราว์เซอร์จริง: หน้า /shop และ /console แสดงชื่อ KooChang ไม่มี error ใน console, bundle ชี้ `https://api-staging.koochang.com` และ fetch จากหน้าเว็บไป API ได้ 200
- สถานะ: ✅ staging ใช้งานผ่าน https://app-staging.koochang.com แล้ว; LAN 192.168.1.127 ปิดแล้ว

### 2026-10-05 — ตั้งชื่อผลิตภัณฑ์ คู่ช่าง / KooChang

- การตัดสินใจ: ชื่อไทย **คู่ช่าง** เป็นชื่อหลักบนหน้าจอ ชื่ออังกฤษ **KooChang** (เลือกแทน KhuChang เพราะอ่านง่ายกว่า โดยรู้ว่ามีโอกาสเล็กน้อยที่จะอ่านเป็น "กู") package และ bundle id `com.koochang.app`
- ทำอะไร: เปลี่ยนชื่อแอปมือถือ (`app.json` name/slug/scheme/package และเพิ่ม iOS bundleIdentifier), `appName` ใน i18n (หัวข้อ push, หน้าต้อนรับ, หน้าเข้าร่วมร้าน), console, เว็บร้าน `/shop`, ชื่อแท็บเบราว์เซอร์, SMS OTP ขึ้นต้นด้วย "คู่ช่าง:" / "KooChang:", ชื่อ issuer ของ TOTP เป็น "KooChang Console", deep link `fieldservice://` เป็น `koochang://`, README, CLAUDE.md, PUSH_FCM.md
- ไม่เปลี่ยน: ชื่อภายใน (โฟลเดอร์, แพ็กเกจ `@field-service/*`, pm2 `fs-*`, ฐานข้อมูล, ตัวแปร env) และเอกสารอ้างอิงใน `docs/reference`
- ผลกระทบ: ลิงก์เข้าร่วมแบบ `fieldservice://` ที่ส่งไปแล้วเปิดแอปไม่ได้ (ลิงก์ https ยังใช้ได้); ผู้ดูแล console ที่ตั้ง TOTP ไว้แล้วยังใช้รหัสเดิมได้ แค่ชื่อในแอป authenticator เป็นชื่อเก่า; Expo Go ใช้ต่อได้ตามเดิม
- ปัญหา: (1) หน้าเข้าสู่ระบบของเว็บร้านใช้ `tr` ที่ไม่มีใน component นั้น → typecheck ไม่ผ่าน แก้เป็น `t` (2) SSH tunnel ไป server2 หลุดระหว่างรันเทสต์ PostgreSQL 16 (Connection reset / Broken pipe) ทำให้เทสต์ล้มเพราะต่อฐานไม่ได้ ไม่ใช่เพราะโค้ด
- ตรวจแล้ว: typecheck ทุก workspace ผ่าน; PGlite 150 ผ่าน / 27 ข้าม / 0 ล้มเหลว; PostgreSQL 16 177 ผ่าน / 0 ล้มเหลว (รอบที่ tunnel ไม่หลุด); `expo config` แสดงชื่อ คู่ช่าง, package `com.koochang.app`

### 2026-10-05 — Push ด้วย Firebase Cloud Messaging เริ่มที่ Android (migration 024)

- การตัดสินใจ: ผู้ใช้เลือกส่ง push ผ่าน FCM โดยตรง (ไม่ผ่าน Expo Push) เริ่มที่ Android ก่อน; iOS เพิ่มภายหลังด้วยโปรเจกต์ Firebase เดิม + APNs key
- ทำอะไร:
  - API/worker: `FcmPushSender` ส่งแบบ FCM HTTP v1 เซ็น JWT ด้วย service account เอง (ไม่เพิ่ม dependency) แคช access token; ตั้งค่า `PUSH_PROVIDER=fcm` + `FCM_SERVICE_ACCOUNT_FILE`; token ที่ตายแล้ว (`UNREGISTERED`) ถูกเพิกถอน, 429/5xx/เครือข่ายล่ม retry, `INVALID_ARGUMENT` ไม่เพิกถอน token; iOS ถูกข้าม; production แจ้ง `CONFIG_MISSING` ถ้ายังไม่ตั้ง
  - migration 024: `worker.claim_deliveries` ข้าม push ที่ค้างคิวของ token ที่ถูกเพิกถอนหรือเปลี่ยนเจ้าของ (มือถือเครื่องเดียวใช้หลายบัญชี)
  - มือถือ: เพิ่ม `expo-notifications`; หลังเข้าสู่ระบบขอสิทธิ์แจ้งเตือนแล้วลงทะเบียน token (`src/push.ts`), ลงทะเบียนใหม่เมื่อ token เปลี่ยน, แสดง push ขณะเปิดแอป, กด push แล้วเปิดกล่องแจ้งเตือนของร้านนั้น, ออกจากระบบแล้วถอด token ก่อน; ใน Expo Go ปิดส่วนนี้อัตโนมัติ; `app.config.js` ใส่ `google-services.json` เมื่อมีไฟล์ (ไฟล์ไม่อยู่ใน git)
- ปัญหา: (1) logout เดิมไม่ถอด device token และ worker ส่ง push ที่ค้างคิวโดยไม่ดูว่า token ถูกเพิกถอนหรือย้ายไปบัญชีอื่น → คนถัดไปที่ใช้มือถือเครื่องเดียวกันอาจเห็น push ของบัญชีเดิม (2) ช่างที่รออนุมัติจะไม่ได้ push "อนุมัติแล้ว" ถ้าลงทะเบียนเฉพาะสมาชิก active (3) คำสั่งลบโฟลเดอร์ทดสอบนอก scratchpad ถูกระบบความปลอดภัยบล็อก
- แก้อย่างไร: (1) แอปถอด token ก่อน logout + migration 024 กันฝั่ง server (2) ลงทะเบียนทุกบัญชีที่เข้าสู่ระบบ และเมื่อกด push ให้โหลดสมาชิกภาพใหม่ก่อน (3) ย้ายไป export ใน scratchpad (คำสั่งที่ถูกบล็อกไม่ได้รัน ไม่มีไฟล์ค้าง)
- ตรวจแล้ว: PGlite 150 ผ่าน / 27 ข้าม / 0 ล้มเหลว; PostgreSQL 16 177 ผ่าน / 0 ล้มเหลว (รวม `tests/push-fcm.test.mjs` ที่จำลอง Google endpoint และ test ใหม่ใน worker); typecheck มือถือผ่าน; `expo export --platform android` ผ่าน; ลง migration 023–024 บนฐาน dev แล้ว
- ยังไม่ได้ทำ: ไม่มีโปรเจกต์ Firebase จริง ไม่ได้ส่ง push จริง ไม่ได้ทดสอบบนมือถือ (ต้องใช้ development build); staging ยังไม่ได้ deploy
- สถานะ: ⏳ รอ **package name จริงของแอป Android** (ตอนนี้ `com.example.fieldservicefoundation`) → สร้าง Firebase → ส่ง `google-services.json` + service account key → build APK ทดสอบ

### 2026-10-05 — แพ็กเกจราคา 3 แพ็กเกจ + จำกัดแค่ช่างกับพื้นที่ (migration 023)

- ทำอะไร: ตั้งแพ็กเกจเปิดตัวใน `database/catalog/launch-plans.sql` (ชุด trial และแพ็กเกจเสียเงิน 3 แพ็กเกจ รันซ้ำได้ ไม่ทับรหัสที่มีอยู่)

  | แพ็กเกจ | ช่าง (ไม่นับเจ้าของ) | พื้นที่รูป | รายเดือน | รายปี |
  |---|---|---|---|---|
  | ทดลองใช้ (trial) 14 วัน | 3 | 5 GB | ฟรี | – |
  | เดี่ยว (solo) | 0 — เจ้าของทำเอง | 10 GB | 290 บาท | 2,900 บาท |
  | ทีมเล็ก (small_team) | 3 | 30 GB | 590 บาท | 5,900 บาท |
  | ธุรกิจ (business) | 10 | 100 GB | 1,290 บาท | 12,900 บาท |

  รายปีราคาเท่ากับ 10 เดือน (ได้ฟรี 2 เดือน); ทุกแพ็กเกจเสียเงินมีช่วงผ่อนผัน 7 วัน
- migration 023: แพ็กเกจตั้งช่าง 0 คนได้ (เดิมบังคับ > 0); OCR ไม่ใช่เงื่อนไขของแพ็กเกจแล้ว (`auth.reserve_usage` และการกด retry OCR ใน console ไม่ตรวจโควตา แต่ยังนับจำนวนครั้งไว้ดูต้นทุน)
- UI: ฟอร์มแพ็กเกจใน console ไม่มีช่อง OCR แล้ว และตั้งช่าง 0 ได้; การ์ดแพ็กเกจบนมือถือ/เว็บร้านแสดง "อ่านป้ายเครื่อง (OCR) ไม่จำกัด" และ "เจ้าของใช้งานคนเดียว"; ร้านที่ใช้แพ็กเกจเดี่ยวเห็นข้อความในหน้าทีมว่าต้องเปลี่ยนแพ็กเกจก่อนรับช่าง
- ปัญหา: staging ไม่มีแพ็กเกจเลย (ไม่ใช้ seed) จึงเห็นว่างใน console; ฐานบังคับให้ทุกแพ็กเกจมีช่างอย่างน้อย 1 คน และ OCR เป็นโควตาที่ทำให้อ่านป้ายไม่ได้เมื่อครบ
- ตรวจแล้ว: typecheck ทุก workspace ผ่าน; PGlite 144 ผ่าน / 27 skipped / 0 failed; PostgreSQL 16 ฐานแยก 171 ผ่าน / 0 skipped / 0 failed (รวมการทดสอบใหม่ แพ็กเกจช่าง 0 คน และ OCR ไม่ติดโควตา); รัน launch-plans.sql 2 รอบบนฐานทดสอบแยก รอบสองไม่เพิ่มอะไร
- ⚠️ ยังไม่ได้ deploy staging: ระบบสิทธิ์ของ Claude บล็อกการคัดลอก bundle ไป server2 ต้องให้ผู้ใช้อนุญาตหรือรันเอง (คำสั่งอยู่ใน DEPLOY_SERVER2.md หัวข้อ "Still to do on staging" ข้อ 2)
- สถานะ: ⏳ deploy f209bff+ และรัน migration 023 + launch-plans.sql บน staging

### 2026-10-05 — รองรับร้านเล็ก: เจ้าของเป็นช่างเอง / ทีม 1-2 คน

- ทำอะไร: ปรับแอปมือถือให้เจ้าของร้านออกงานเองได้สะดวก ไม่ต้องเปลี่ยน API หรือฐานข้อมูล
  - หน้าแรกของเจ้าของมีปุ่ม "บันทึกงานหน้างาน" และรายการ "งานของฉัน" เหมือนช่าง
  - ร้านที่ยังไม่มีช่าง (ช่างใช้งาน 0 คนและไม่มีคำขอรอ) ซ่อนตัวเลขสถิติทีม และเปลี่ยนแถวทีมเป็น "เพิ่มช่างในทีม · ทำงานคนเดียวได้เลย ชวนช่างเข้าร่วมเมื่อพร้อม"
  - สร้างงานและนัดงานบำรุงรักษา: ถ้าร้านไม่มีช่าง ตั้งผู้รับงานเป็น "ฉันทำเอง" ให้อัตโนมัติ (ยังเปลี่ยนได้)
- ปัญหา: ร้านเจ้าของคนเดียวมีจำนวนมาก แต่หน้าจอเดิมออกแบบให้เจ้าของเป็นผู้จัดการอย่างเดียว ต้องกดมอบหมายให้ตัวเองทุกครั้ง และหน้าแรกไม่มีทางลัดไปทำงาน
- สาเหตุ: API รองรับอยู่แล้ว (มอบหมายงานให้ตัวเอง เริ่มงาน บันทึกผล และบันทึกงานหน้างานโดยไม่ต้องตรวจ role) และเจ้าของไม่นับเป็นที่นั่งช่าง ช่องว่างอยู่ที่ UI อย่างเดียว
- ตรวจแล้ว: typecheck ทุก workspace ผ่าน; ยังไม่ได้ตรวจบนหน้าจอเพราะ dev server ของแอปรันอยู่ในแชตอื่น (Metro 8081 จะ reload ให้บนมือถือ)
- สถานะ: ⏳ รอดูบนมือถือ; ⏳ รอตัดสินใจเรื่องแพ็กเกจราคาสำหรับร้านคนเดียว (ตอนนี้ Starter มี 3 ที่นั่ง 590 บาท)

### 2026-10-05 — ปิดงานโค้ดที่ทำเองได้: นับร้านที่ชำระเงินแบบเร็ว (migration 022)

- ทำอะไร: ผู้ใช้สั่ง "ทำต่อให้เสร็จ" จึงไล่งานที่เหลือ; ข้อ B/C/D ต้องใช้การตัดสินใจ, key หรือมือถือของผู้ใช้ ส่วนที่เป็นโค้ดล้วนคือ E1 และ E3
- E1 ปัญหา: สรุปการเงินใน console นับ "ร้านที่ชำระเงินอยู่" ช้า (~2 วินาที) และจะช้าขึ้นตามจำนวนร้าน
- สาเหตุ: เรียก `billing.entitlement()` ทีละร้าน (plpgsql หลาย query ต่อร้าน)
- แก้อย่างไร: migration 022 เพิ่ม `billing.paid_shop_count()` คำนวณครั้งเดียวจาก subscription_periods ด้วยกติกาเดียวกับ entitlement (งวดปัจจุบันที่เลือก = paid; หรือไม่มีงวดปัจจุบัน งวดล่าสุด paid ไม่ยกเลิก และยังอยู่ใน grace) แล้วให้ `padmin.finance_report` ใช้ฟังก์ชันนี้
- ตรวจแล้ว: เทสต์ใหม่เทียบผลกับการนับแบบเดิมที่วันนี้/+20/+33/+40/+45/+400 วัน รวมร้านที่ตั้งยกเลิกปลายงวด ผ่านบน PostgreSQL 16; migrate ฐาน dev ถึง 022 แล้ว
- E3: ตรวจแล้วยังไม่มีโค้ดส่วนใดเขียนลง `ops.outbox_events` เลย การทำ consumer ทั่วไปตอนนี้จึงไม่มีอะไรให้ประมวลผล → ทำเมื่อมี event จริงตัวแรก (เช่นตอนเลือกผู้ให้บริการ Push) ไม่ใช่ตัวบล็อก pilot
- สถานะ: งานโค้ดที่ไม่ต้องรอข้อมูลจากผู้ใช้หมดแล้ว; **staging ยังอยู่ที่ migration 021** — อัปเดตเมื่อผู้ใช้สั่ง (ตามกติกาไม่ deploy เองจากเอกสาร)

### 2026-10-05 — ปรับดีไซน์เว็บร้านค้า (/shop) ให้เข้าชุดกับ console

**ทำอะไร:** ผู้ใช้ขอให้ redesign เว็บร้านค้าด้วย จึงย้ายเว็บร้านมาใช้ระบบดีไซน์เดียวกับ console ใหม่: เมนูข้างสีขาวแบ่ง 3 กลุ่ม (งานประจำวัน / ร้านของฉัน / ช่วยเหลือและบัญชี) มีไอคอน, ตัวเลือกร้านด้านบนเมนูพร้อมปุ่ม + สร้างร้าน, top bar (ชื่อร้าน / หน้า, ภาษา), drawer บนมือถือ (เดิมเป็นแถบเลื่อนแนวนอน), หน้าเข้าสู่ระบบเป็นการ์ด, การ์ดตัวเลขหน้าแรกมีไอคอน, หน้ารายละเอียดไฮไลต์เมนูแม่ (เช่น งาน → งานบริการ); owner.css เหลือเฉพาะส่วนของร้าน

**ผลตรวจ:** typecheck + Next production build ผ่าน; เทสต์ i18n + owner web ผ่าน; เปิดครบ 9 หน้าเป็นภาษาไทยบนจอ 375px ไม่ล้นจอไม่มี error (ทดสอบด้วยร้านทดลองบนเครื่อง dev เบอร์ทดลอง 0800009876)

### 2026-10-05 — super admin ทำรายการได้เองโดยไม่ต้องมีผู้อนุมัติ (migration 021)

**ทำอะไร:** ผู้ใช้สั่งว่า super admin สร้างแพ็กเกจหรือทำการใด ๆ ไม่ต้องมีผู้อนุมัติอีก: super admin มีสิทธิ์ทุกอย่าง (รวมสิทธิ์ที่จะเพิ่มในอนาคต ทั้งใน API guard และ `padmin.require`); คำขอบทบาท/กู้บัญชี/แพ็กเกจ/นโยบายที่ super admin ส่งมีผลทันทีใน transaction เดียว; อนุมัติคืนเงิน, อนุมัติเข้าดูข้อมูลร้าน และดำเนินการปิด/ลบร้านของตัวเองได้; บันทึก audit `self_approved`; หน้าจอเปลี่ยนปุ่มเป็น "เผยแพร่ทันที / บันทึกและใช้ทันที" สำหรับ super admin
- คงไว้: การยินยอมของเจ้าของร้าน, hold/retention/ยอดค้าง, ห้ามปิดหรือกู้บัญชีตัวเอง, ต้องเหลือ super admin อย่างน้อย 1 คน; บทบาทอื่นยังต้องสองคน
- ข้อจำกัดในตาราง refunds (ผู้อนุมัติ ≠ ผู้ขอ) ถูกย้ายไปตรวจในฟังก์ชันแทน

**1. เทสต์เดิมล้มเหลว 6 ข้อ** — สาเหตุ: เทสต์ใช้บัญชี super admin ทดสอบกฎสองคน; แก้: ทดสอบกฎสองคนด้วย platform_admin และเพิ่มกรณี super admin ทำได้ทันที (แพ็กเกจ, บทบาท, กู้บัญชี, คืนเงิน) ✅

**2. เทสต์ "อัปเกรดเป็น Team" ล้มเหลวแบบสุ่มบน PostgreSQL 16** — สาเหตุ: เทสต์ส่งเวลาชำระจากนาฬิกาเครื่อง dev แต่ตรวจสิทธิ์ด้วยนาฬิกาฐานข้อมูล ต่างกันไม่กี่มิลลิวินาทีพอให้รอบเริ่มหลัง now(); แก้: ใช้เวลาย้อน 1 นาทีในเทสต์ (ไม่ใช่บั๊กของระบบ) ✅

**ผลตรวจ:** PGlite 142 ผ่าน 27 ข้าม; PostgreSQL 16 169/169 (หลังแก้เทสต์สุ่ม รันซ้ำ 3 รอบผ่าน); typecheck ผ่าน

### 2026-10-04 (ดึก) — ปรับดีไซน์ console ให้ทันสมัย (แนว SaaS สว่าง)

**ทำอะไร:** ผู้ใช้บอกว่า console ดูเรียบง่ายเกินไปและไม่ทันสมัย เลือกแนว SaaS สว่าง (แบบ Stripe/Linear) จึงปรับ: เมนูด้านข้างแบ่ง 6 กลุ่มพร้อมไอคอน (lucide-react), top bar แสดงตำแหน่งหน้า ภาษา และบทบาท, เมนูแบบ drawer บนจอแคบ, ฟอนต์ Inter + Noto Sans Thai แบบ self-host (next/font), การ์ดตัวเลขมีไอคอนสี, ตาราง ปุ่ม ช่องกรอก ป้ายสถานะ หน้าเข้าสู่ระบบ และหน้าต่างยืนยันตัวตนแบบใหม่

**1. สาเหตุที่ดูเก่า**
- CSS ตั้งชื่อฟอนต์ Noto Sans Thai แต่ไม่ได้โหลดไฟล์ฟอนต์ หน้าจอจึงแสดงเป็น Tahoma; ไม่มีไอคอน; เมนู 19 รายการไม่แบ่งกลุ่ม; ไม่มี top bar
- แก้: โหลดฟอนต์ด้วย next/font (ไม่เรียก Google ตอนผู้ใช้เปิดหน้า), เพิ่มไอคอนและโครงสร้างใหม่ ✅

**2. หน้ารายการร้านขึ้น error บนเครื่อง dev**
- สาเหตุ: ฐานข้อมูล dev บน server2 ยังอยู่ที่ migration 013 แต่ API ใหม่เรียกฟังก์ชันจาก 020
- แก้: รัน migration 014–020 กับฐาน dev ✅

**3. ข้อความ error เก่าค้างบนหน้ารายการร้านหลังโหลดใหม่สำเร็จ** (bug เดิม)
- แก้: ล้าง error ทุกครั้งที่โหลดรายการ ✅

**ผลตรวจ:** typecheck + Next production build ผ่าน; ตรวจในเบราว์เซอร์ (ภาษาไทย): หน้าเข้าสู่ระบบ, ภาพรวม, ร้าน, drawer บนจอ 375px ไม่ล้นจอ

### 2026-10-04 (ดึก) — ติดตั้ง staging บน server2 (ใช้ภายใน LAN)

**ทำอะไร:** ผู้ใช้อนุมัติให้ติดตั้ง ยังไม่มีชื่อระบบและโดเมน จึงติดตั้งแบบใช้ภายใน LAN ก่อน: Node 24 ใน /opt/node-24, pnpm 11.25, PostgreSQL cluster ใหม่ 16/staging พอร์ต 5434, ไฟล์ค่าลับสร้างบน server (`infra/deploy/staging-setup.sh`), migration 001–020 (68 ตาราง ไม่มี seed), pm2 3 บริการ (`infra/deploy/staging.ecosystem.config.cjs`), backup รายวัน + ตรวจกู้คืนรายสัปดาห์ (ทดสอบแล้ว RESTORE OK) รายละเอียด [DEPLOY_SERVER2.md](DEPLOY_SERVER2.md)

**1. Build บน server ล้มเหลว: หา module 'express' ไม่เจอ**
- สาเหตุ: `privacy.controller.ts` import ชนิดจาก express ซึ่ง api ไม่ได้ประกาศเป็น dependency; บนเครื่อง dev ผ่านเพราะ Node หาเจอใน node_modules ของโปรเจกต์ ServiceFlow เดิมที่โฟลเดอร์แม่
- แก้: ใช้ชนิด Response แบบสั้นที่ประกาศเองเหมือน controller อื่น (d60b4ec) ✅

**2. Worker ขึ้น online แต่ไม่ทำงาน**
- สาเหตุ: worker เช็กว่าถูกรันตรงจาก `process.argv[1]` แต่ pm2 รันผ่านตัวห่อ จึงไม่เข้า main()
- แก้: ใช้ `pm_exec_path` ของ pm2 ก่อน (d9b25a6); ตรวจแล้ว worker ต่อฐานข้อมูลและเปิดทะเบียนการลบ ✅

**การตัดสินใจ:** staging รอบแรกรัน `NODE_ENV=development` (OTP อยู่ใน log, OCR จำลอง) เพราะยังไม่มี HTTPS และ DeeSMSx key; ฟังเฉพาะ IP วง LAN 192.168.1.127; backup สำเนาไป /data3 จนกว่าจะมีปลายทางนอกเครื่อง; บัญชี console ให้เจ้าของบัญชีสร้างเองบน server (ผมไม่สร้างบัญชีหรือดูรหัสผ่านบนเครื่องจริง)

**ผลตรวจ:** `/v1/ready` ready, หน้า /console และ /shop ตอบ 200, CORS จาก :3200 ผ่าน, login ผิดได้ LOGIN_FAILED ตามคาด, backup + restore-check ผ่าน

### 2026-10-04 (ค่ำ) — เลือก server2 สำหรับติดตั้ง staging/pilot

**ทำอะไร:** ผู้ใช้เลือกติดตั้งบน server2, เริ่มเป็น staging/pilot ก่อน, ใช้ subdomain ผ่าน Cloudflare Tunnel และ PostgreSQL cluster ใหม่แยก (16/staging พอร์ต 5434); สำรวจ server2 แบบอ่านอย่างเดียว (ไม่ได้แก้อะไร) แล้วเขียนแผนใน [DEPLOY_SERVER2.md](DEPLOY_SERVER2.md)

**สิ่งที่พบ:** server2 ใช้ร่วมกับระบบอื่น ~20 แอป (pm2, Apache 80/443, cloudflared แบบ token จัดการจาก dashboard); Node ระบบเป็น v18 (ต้องติดตั้ง Node 24 แยกใน /opt); ไม่มี pnpm; ดิสก์ / เหลือ 23 GB จึงเก็บรูปและ backup บน /data

**ยังต้องการ:** ชื่อโดเมนใน Cloudflare และคนเพิ่ม hostname ใน dashboard; DeeSMSx key ถ้าจะให้มือถือจริงเข้าสู่ระบบบน staging แบบ production mode

### 2026-10-04 (ค่ำ) — OCR ป้ายเครื่องด้วย Claude API

**ทำอะไร:** ผู้ใช้เลือก Claude API เป็นผู้ให้บริการ OCR จึงเพิ่ม `ClaudeOcrProvider` (Anthropic TypeScript SDK) ส่งรูปป้ายเครื่องพร้อม JSON schema ให้ตอบ brand / model / serial / ข้อความทั้งหมด / ความมั่นใจ; ตั้ง `OCR_PROVIDER=claude` + `ANTHROPIC_API_KEY` ฝั่ง server (ไม่มี key = ปิด OCR ตอบ 503 ให้กรอกเอง); เทสต์ใหม่ `tests/ocr-claude.test.mjs` 4 ข้อด้วย client จำลอง; รายละเอียดใน [OCR_CLAUDE.md](OCR_CLAUDE.md)

**1. เทสต์แยกข้อผิดพลาดชั่วคราวล้มเหลวรอบแรก**
- สาเหตุ: เทสต์โหลด SDK แบบ CommonJS แต่โค้ดจริงโหลดแบบ ESM ทำให้คลาส error เป็นคนละตัว `instanceof` จึงไม่ตรง (ปัญหาเฉพาะในเทสต์)
- แก้: เทสต์ import SDK ผ่าน ESM entry ตัวเดียวกับ API ✅

**การตัดสินใจ:** ใช้ `claude-opus-5` เป็นค่าเริ่มต้น (เปลี่ยนได้ด้วย `OCR_CLAUDE_MODEL`), effort ต่ำ, เปิด fallback อัตโนมัติเมื่อถูกปฏิเสธ; 429/5xx/เครือข่าย = ลองใหม่ ไม่กินโควตา; คำขอผิด/คีย์ผิด/ถูกปฏิเสธ = ล้มเหลวทันที

**ผลตรวจ:** typecheck ผ่าน; PGlite 141 ผ่าน 27 ข้าม 0 ล้มเหลว; ยังไม่ได้เรียก API จริง (ต้องมี key และอนุญาตก่อน)


### 2026-10-04 (ค่ำ) — ปิดงาน Console ให้ครบ (migration 020)

**ทำอะไร:** ไล่รายการใน CONSOLE_HANDOFF ครบ 10 ข้อ เพิ่มเทสต์ `tests/console-completion.test.mjs` 9 ข้อ, migration `020_console_reports.sql`, worker `replay-erasure` + ทะเบียนการลบนอกฐานข้อมูล, API รายงานการเงิน/สรุปเหตุขัดข้อง/แบ่งหน้า, หน้าจอ console (สรุปการเงิน, แผงเหตุขัดข้อง, ปุ่มแบ่งหน้า, หน้าอนุมัติอ่านง่าย)

**1. Restore แล้วข้อมูลที่ลบไปแล้วกลับมา**
- สาเหตุ: `worker.replay_erasure()` ไม่มีใครเรียกใช้; งานลบรูปที่สถานะ `succeeded` ใน backup จะไม่ถูกรันซ้ำ; ถ้า backup เก่ากว่าวันที่ลบ tombstone ก็หายไปด้วย
- แก้: `worker.replay_erasure(uuid[])` ลบซ้ำทั้งจาก tombstone ในฐานและรายชื่อจากไฟล์ทะเบียน, สร้าง tombstone ที่หายกลับ (`source='registry'`), ตั้งงานลบรูปกลับเป็น queued; worker เขียน `ERASURE_REGISTRY_FILE` แบบเพิ่มอย่างเดียว; คำสั่ง `node dist/worker.js replay-erasure` ใส่ใน PILOT_RUNBOOK
- สถานะ: ✅ มีเทสต์จำลอง restore ผ่าน

**2. การลบข้อมูลร้านยังเหลือข้อความบางคอลัมน์**
- ตรวจ: ดึงทุกคอลัมน์ text/jsonb ของตารางที่มี organization_id มาเทียบกับฟังก์ชันลบ
- พบ: `notifications.sent_snapshot` (ข้อความแจ้งเตือนที่อาจมีชื่อลูกค้า), `ocr_requests.accepted_fields` (serial), `maintenance_cycles.close_reason`
- แก้: เพิ่มใน `padmin.erase_business_content` (020) ✅

**3. เทสต์ OCR retry / Stripe refresh ล้มเหลวรอบแรก**
- สาเหตุ: เทสต์คาดว่าบทบาท `operations` จะถูกปฏิเสธ แต่บทบาทนี้มีสิทธิ์ `operations.manage` จริง (เทสต์ผิด ไม่ใช่โค้ด)
- แก้: ใช้บัญชีฝ่ายการเงินทดสอบกรณีไม่มีสิทธิ์ ✅

**4. หน้าอนุมัติแสดง JSON ดิบ**
- แก้: แสดงรายละเอียดเป็นข้อความ (แพ็กเกจ/ราคา/บทบาท/นโยบาย) และชื่อ-อีเมลบัญชีเป้าหมาย (`padmin.approvals` ส่ง `target`) ✅

**5. เครื่องมือเขียนไฟล์ผ่าน shell ทำ backslash/backtick หาย**
- อาการ: regex `\d` ใน controller กลายเป็น `d`, template string ในเทสต์หาย
- แก้: แก้ด้วย Edit tool และตรวจด้วย typecheck/เทสต์; ต่อไปใช้สคริปต์ node หรือ Edit แทน heredoc ที่มีอักขระพิเศษ ✅

**6. สรุปการเงินดูเหมือนไม่ขึ้น**
- สาเหตุ: แค่ช้า (คำนวณสิทธิ์ทุกร้านเพื่อนับร้านที่ชำระเงิน) ผลขึ้นหลังรอ ~2 วินาที; ปรับคำว่า "Count" เป็น "items/รายการ"
- สถานะ: ✅ ถ้าร้านมากขึ้นควรเปลี่ยนเป็นนับจากตาราง subscription โดยตรง

**ผลตรวจ:** PostgreSQL 16 164/164 ผ่าน; PGlite 137 ผ่าน 27 ข้าม; typecheck + Next build ผ่าน; browser QA ด้วยบัญชีสังเคราะห์ (ปิด fixture และลบ token แล้ว)

### 2026-10-04 — บันทึกสถานะทั้งหมดระหว่างทำ Console ให้ครบ (checkpoint)

- คำสั่งผู้ใช้: ทำ Console ให้เสร็จทั้งหมด และบันทึกสถานะการทำงานปัจจุบันทั้งหมด โดยยังไม่พร้อม UAT/ทดสอบมือถือจริง
- สิ่งที่ทำแล้วในรอบนี้: เทียบสเปกโมดูล Console; เพิ่ม migrations 017 ทีม/คำเชิญ/ร่างแพ็กเกจ/approval/policy, 018 ประกาศ/incident/operations checks/คิว, 019 export/closure/deletion/holds/tombstones/media erasure; เพิ่ม controller และหน้าจอจริง พร้อมเมนูตามสิทธิ์และข้อความไทย/อังกฤษ
- ทีม: คำเชิญเก็บ token hash, MFA secret เข้ารหัส, ใช้ครั้งเดียวภายใน 48 ชั่วโมงและจำกัดรหัสผิด 5 ครั้ง; การเปลี่ยนบทบาทต้องมีผู้อนุมัติอีกคนและ revoke sessions; ปิด/เปิดบัญชีและออกจากทุกเครื่อง; เพิ่ม recovery แบบอนุมัติสองคนและสร้างคำเชิญใหม่ล่าสุด **ยังต้องทดสอบ**
- แพ็กเกจ: บันทึกร่างด้วย version, ขออนุมัติเผยแพร่เป็น immutable plan/price versions, หยุดขาย, รายเดือน/ปี; ใบแจ้งชำระเดิมคง snapshot; เพิ่มราคา 0 ภายในสำหรับ trial publication ล่าสุด **ยังต้องทดสอบ**
- นโยบาย: อนุมัติสองคน เปิด/ปิดการสร้างร้านและใบแจ้งชำระใหม่; ระยะเก็บเนื้อหาและพักคำขอลบต้องกำหนดอย่างชัดเจนและผ่านอนุมัติ ไม่ตั้งตัวเลข production เอง; ยังต้องตรวจผล UI/สิทธิ์ให้ครบ
- ประกาศ/เหตุขัดข้อง: สร้างร่าง/กำหนดเวลา/เผยแพร่/ถอนประกาศ กลุ่มทุกร้าน ทดลองใช้ ชำระเงิน หรือระบุร้าน; owner feed ใช้เวลา server; incident เก็บ severity/status/services และ timeline ต่อท้าย; เชื่อม feed กับ owner web/mobile แล้วแต่ **ยังไม่ตรวจ browser/device**
- Operations: แสดงคิว Push/OCR/outbox/รายการ Stripe ที่ต้องติดตาม; retry failed Push โดยคงรายการเดิม; บันทึกผลตรวจ API/storage/OCR/webhook/backup/restore พร้อมหลักฐาน โดยไม่อ้างว่าการบันทึกทำ backup/restore จริง; เพิ่ม OCR retry และ Stripe refresh ล่าสุด **ยังต้องทดสอบ**; outbox ยังไม่มี generic consumer/replay ที่ทำงานจริง
- ความเป็นส่วนตัว: ไฟล์ส่งออก JSON เข้ารหัส อายุ 24 ชั่วโมง ดาวน์โหลดเฉพาะเจ้าของผู้ขอ; staff เห็น metadata; ปิดร้านจริง; ลบเนื้อหาร้านต้อง owner request, ผู้ดำเนินการคนละคนกับผู้อนุมัติ, ไม่มี hold/รายการเงินค้าง, พ้น retention/cooling; ปิดการเข้าถึงและล้างเนื้อหาในฐาน ก่อน worker ลบรูปแล้วจึงสำเร็จ; ไม่ลบเอกสารการเงิน/ตัวตนร่วม/backup ทันที; ยังต้องตรวจข้อมูลที่ครอบคลุม ความครบของการล้าง และ restore replay
- ผลตรวจที่ผ่าน: migrations 001–019 บน PGlite, 64 ตาราง, foundation + settings 25 กรณี; ชุด Console management 12 กรณีผ่าน (HTTP permission/TOTP/invitation/MFA/replay, dual approval/session revoke, immutable invoice/month/year, rejected draft/stale version, policy, announcement audience/schedule, incident/check evidence, delivery retry, encrypted export/expiry/owner isolation, holds/cooling/worker erasure, actual closure)
- ปัญหาและแก้ไข: เพิ่ม role-specific SQL error mapping ให้ test adapter ตรง production; แก้ fixtures เบอร์แบบ E.164 และเงื่อนไข media processed; แก้ TypeScript noUncheckedIndexedAccess/ข้อความแปลซ้ำ; แก้ JSX จากการแทนข้อความ; เปลี่ยน export HTTP regression จากเปลี่ยนสถานะด้วยมือเป็นสร้างและดาวน์โหลด artifact จริง
- สิ่งที่ยังไม่ผ่านการยืนยัน: งานใหม่หลัง targeted test 12 ข้อ, full regression/PostgreSQL 16/production build/browser รอบล่าสุด, รายงานการเงินใหม่และการเก็บรายละเอียดรายการจำนวนมาก; ไม่ได้ deploy, ใช้เงินจริง, ส่ง SMS จริง หรือทำ UAT
- สถานะการส่งต่อ: บันทึก checkpoint และรายการไฟล์/ขั้นตอนต่อใน CONSOLE_HANDOFF.md; commit ที่สมบูรณ์ก่อนรอบนี้คือ `a4a55fd`; ไม่มี remote/PR/push; อย่าใช้ผล full PostgreSQL 16 เดิม 143 ผ่านเป็นหลักฐานว่างาน Console เพิ่มชุดนี้ผ่านแล้ว

### 2026-10-04 — ทำส่วนตั้งค่า /console และบัญชีผู้ดูแล

- ทำอะไร: เพิ่มหน้า platform settings ตั้งบัญชีรับเงิน/รหัสธนาคาร/PromptPay, DeeSMSx sender + keys และ EasySlip key พร้อมเปิด/ปิด; เพิ่ม my account แก้ชื่อ/ภาษา เปลี่ยนรหัสผ่านและออกจากระบบเครื่องอื่น; Stripe แสดง webhook URL เต็ม อ่านค่าล่าสุดและสถานะการตั้งค่า
- การใช้งานจริง: settings ที่บันทึก override environment และมีผลในคำขอถัดไปโดยไม่ restart รวมปิดบริการที่เคยตั้ง env; ใบแจ้งชำระใหม่ freeze บัญชีรับ ขณะที่ใบเดิมยังใช้ snapshot เดิม; ไม่เพิ่มปุ่มที่แอบส่ง SMS หรือสร้างค่าใช้จ่ายจริง
- ความปลอดภัย: permission settings.manage สำหรับ platform_admin/super_admin, TOTP step-up และ optimistic version; API/service keys เก็บเข้ารหัสและไม่คืนหน้าเว็บ/audit; SQL ผูก profile/session กับบัญชีของผู้เรียก ผู้ใช้แก้ของคนอื่นไม่ได้; เปลี่ยนรหัสต้องรหัสเดิม >=12 ตัวอักษรใหม่และใช้ lockout เดิม พร้อม revoke เครื่องอื่น
- ปัญหา/แก้ไข: test adapter แรกไม่ได้ส่ง identity/tenant transaction ให้ billing จึงแก้ fixture ให้ใช้ fs_api จริง; คำแนะนำ webhook เดิมบอกให้เติมโดเมนทั้งที่เปลี่ยนเป็น URL เต็มแล้ว จึงแก้ไทย/อังกฤษหลังตรวจ browser; แสดง browser/OS อ่านง่ายแทน user-agent ยาว; production diagnostics อ่าน console override ก่อนแจ้งค่าที่ขาด
- ตรวจแล้ว: workspace typecheck และ API/Next production build ผ่าน; PGlite full ก่อนเพิ่ม diagnostics test สุดท้าย 142 ข้อ ผ่าน 115 / skipped 27 / failed 0 และ targeted ล่าสุด 21 ผ่านทั้งหมด; PostgreSQL 16 full ล่าสุด 143 ผ่าน / skipped 0 / failed 0 รวม console 8 กรณี OTP/EasySlip/Stripe และ workflow/concurrency เดิม
- Browser QA: ฐานแยก owner_web ผ่านบัญชีสังเคราะห์ ลงชื่อเข้าใช้ MFA, บันทึกธนาคาร/ชื่อผู้ดูแลและอ่านกลับ, หน้า DeeSMSx/EasySlip/Stripe และบัญชี, สลับไทย/อังกฤษ, ตรวจ My account/Stripe ที่ 320px ไม่มีล้น; ไม่เปลี่ยนรหัสผ่านผ่าน browser (ตรวจด้วย HTTP tests แล้ว) ไม่ใช้ keys/provider/ข้อมูลร้านจริง
- สถานะ: โค้ดและคู่มือพร้อม ไม่มี deploy/UAT/เงินจริง/SMS จริง; การสร้าง/กำหนด role บัญชีแพลตฟอร์มยังใช้ operator tool ตามเดิม OCR/Push และบริการจริงยังอยู่ในงานก่อน pilot

### 2026-10-04 — DeeSMSx สำหรับ OTP

- ทำอะไร: ตามผู้ใช้เลือก DeeSMSx เพิ่ม production sender ตาม JSON API จริง ใช้ OTP ไทย/อังกฤษและข้อจำกัดการขอรหัสเดิม ตั้ง keys/ชื่อผู้ส่งผ่าน server environment ไม่แก้ .env จริง
- ปัญหา/สาเหตุ/แก้ไข: เดิมมีเพียง development logger จึงเพิ่ม provider แบบ fail closed; เอกสาร response 200 ระบุเพียง JSON object ไม่มี success field จึงตรวจตามสัญญาที่เผยแพร่และไม่อ้างว่าส่งถึงโทรศัพท์แล้ว; ป้องกัน redirect, timeout 10 วินาที และไม่ retry อัตโนมัติเมื่อผลส่งไม่แน่นอนเพื่อไม่ส่ง/คิดเครดิตซ้ำ
- ความปลอดภัย: ไม่บันทึก keys/OTP/provider response ใน production, error ส่งกลับ 503 แบบทั่วไป, QA child process ตัด DeeSMSx credentials ออก; production diagnostic แจ้งชื่อค่าที่ขาดและปฏิเสธ provider ที่ไม่รองรับ
- ตรวจแล้ว: API TypeScript build ผ่าน; ชุด SMS/OTP unit และ service integration ผ่าน 13 / failed 0 โดย mock provider ทุกคำขอ ครอบคลุมค่าหาย เบอร์ ไทย/อังกฤษ HTTP error/timeout/response ผิดรูปแบบ การไม่ retry และ hashed OTP; sandbox บล็อก test subprocess ครั้งแรกด้วย EPERM จึงรันซ้ำด้วยสิทธิ์ที่อนุญาตจนผ่าน
- สถานะ: โค้ด/คู่มือพร้อม ยังไม่มี keys/ชื่อผู้ส่งจริง ไม่ได้ส่ง SMS ใช้เครดิต deploy หรือ UAT รอบนี้

### 2026-10-04 — Stripe QR/บัตรเครดิตและตั้งค่าบัญชีแพลตฟอร์ม

- ทำอะไร: เพิ่มหน้าตั้งค่า Stripe สำหรับผู้ดูแลที่มี payments.manage พร้อม TOTP, เก็บ secret/webhook key แบบเข้ารหัสและไม่ส่งกลับหน้าเว็บ; เว็บร้าน/มือถือเลือก QR PromptPay หรือบัตรเครดิตผ่าน Stripe Checkout ได้ โดยยังใช้สลิป EasySlip ได้
- ผลชำระ: ตรวจลายเซ็น webhook และอ่านสถานะจริงจาก Stripe ตรวจยอด THB/ใบแจ้งชำระ/ร้าน/โหมดก่อนบันทึกยอดและเปิดรอบสมาชิกทันทีใน transaction เดียว ป้องกันรายการพร้อมกัน การยืนยันซ้ำ และการสลับช่องทางระหว่างจ่าย; ข้อผิดปกติเข้าคิวแอดมิน การหมุน keys ไม่ทำให้รายการเดิมตรวจไม่ได้
- ปัญหา/สาเหตุ/แก้ไข: Stripe SDK 23 เปลี่ยนพารามิเตอร์สร้าง Checkout เป็น allowed_payment_method_types จึงปรับตาม SDK; policy ที่เรียกฟังก์ชัน auth โดยตรงขาดสิทธิ์ จึงใช้ core.owner_allowed ตามแนวทาง RLS เดิม; ปิด test mode ใน production ก่อนเรียก provider; เมื่อสร้างรายการผิดพลาดหน้าเว็บ/มือถืออ่านสถานะใหม่เพื่อให้ลองต่อได้
- ตรวจแล้ว: ชุด PGlite ล่าสุด 131 ข้อ ผ่าน 104 / skipped 27 / failed 0; PostgreSQL 16 ครอบคลุม Stripe 13 กรณีผ่านทั้งหมดจากสองรอบที่มี rotation ซ้ำหนึ่งกรณี และ payments HTTP เดิมผ่านอีก 1 กรณี รวม webhook HTTP จริงกับ provider จำลอง, concurrency, rollback, suspension, late payment และ tenant isolation; typecheck ทุก workspace และ API/Next production build รอบสุดท้ายผ่าน (sandbox บล็อก spawn EPERM ในครั้งแรก จึงตรวจซ้ำด้วยสิทธิ์ที่อนุญาต)
- ข้อจำกัด: ยังไม่เชื่อมบัญชี Stripe จริง ไม่ใช้เงินจริง ไม่ deploy และไม่ทำ UAT/มือถือจริง รอบนี้เป็นการจ่ายใบแจ้งชำระรายครั้ง; การคืนเงินจริงผ่าน Stripe/dispute/payout synchronization ยังไม่เพิ่ม มือถือเปิด browser และอ่านสถานะเมื่อกลับแอป

### 2026-10-04 — EasySlip ตรวจสลิปและเปิดสิทธิ์ทันที

- ทำอะไร: ตามคำสั่งผู้ใช้เปลี่ยนจากรอแอดมินทุกสลิป เป็น EasySlip v2 ตรวจทันที ตรวจผ่านเปิดสิทธิ์ร้านใน transaction เดียว รายการผิดยอด/ผิดผู้รับ/ซ้ำ/วันที่ผิด/อ่านไม่ได้/บริการล่มหรือยังไม่ตั้งค่า ให้แอดมินตรวจต่อ
- ปัญหา: เดิมมีแค่อัปโหลดและ manual confirmation และการส่ง proof_id เดิมสามารถเขียนทับรูปก่อนตรวจฐานข้อมูล อีกทั้ง retry หลังยืนยันแล้วถูกปฏิเสธเพราะใบแจ้งชำระปิด
- สาเหตุ: ยังไม่ได้เลือกผู้ให้บริการ และบันทึกรูปก่อนตรวจ idempotency
- แก้อย่างไร: เพิ่มตัวเชื่อม EasySlip ตามเอกสารจริงพร้อม timeout 20 วินาที ตรวจยอด THB บัญชีและเลขที่มองเห็น วันที่และ duplicate; freeze บัญชีรับในใบแจ้งชำระ; ลงทะเบียน proof/checksum ก่อนเก็บรูป; fs_worker เฉพาะทางยืนยันอัตโนมัติ ขณะที่ fs_api เรียกไม่ได้; nonce/locks/unique reference ป้องกันทำซ้ำ; รายการอัตโนมัติแสดงผู้ตรวจ EasySlip ใน console/CSV ไม่ปลอมตัวเป็นบัญชีแอดมิน
- การยืนยัน: payment + invoice paid + proof accepted + paid period + audit + notification commit พร้อมกัน หากเปิดรอบล้มเหลว rollback ทั้งชุด การชำระไม่ยกเลิก security suspension
- ปัญหาที่พบระหว่างตรวจ: เวลาเครื่องทดสอบช้ากว่าฐาน PostgreSQL ประมาณ 4 วินาที ทำให้เวลาของข้อมูลสังเคราะห์ก่อน invoice.created_at; ปรับ fixture ให้สร้างเวลาจากฐานข้อมูล ไม่ลดความเข้มงวดของผลตรวจ
- ตรวจแล้ว: typecheck ทุก workspace และ API/Next production build ผ่าน; PGlite ชุดล่าสุด 118 ข้อ ผ่าน 92 / skipped 26 / failed 0; EasySlip บน PostgreSQL 16 ผ่าน 11 / skipped 0 / failed 0 รวม controller/service จริงกับ HTTP provider จำลอง, concurrent reference/claim, replay, การกระทบยอด, แอดมินตรวจต่อ, suspension และ rollback; HTTP ชำระเงิน/คืนเงิน/สิทธิ์/TOTP เดิมผ่านอีก 1 ข้อ
- สถานะ: โค้ดและเอกสารเสร็จ ไม่มีเรียก EasySlip จริง/ใช้เงินจริง/ตั้ง secrets/ลงระบบจริงหรือ UAT ในรอบนี้ ตัวช่วย QA ตัด EasySlip credentials ออกจาก process ทดสอบแล้ว

### 2026-10-04 — ทำเว็บต่อ: แบ่งหน้ารายการลูกค้าและงาน

- ทำอะไร: เพิ่มปุ่มหน้าก่อน/ถัดไปและเลขหน้าในเว็บร้าน ลูกค้าและงานหน้าละ 50 รายการ เปลี่ยนคำค้น/ตัวกรองแล้วกลับหน้าแรก
- ปัญหา: ร้านที่มีลูกค้าเกิน 100 หรืองานเกิน 200 เห็นเพียงบางส่วนของรายการ แม้ใช้เว็บบริหารร้านแล้ว
- สาเหตุ: API มี LIMIT แต่ไม่มีวิธีขอหน้าถัดไป และเว็บไม่แสดงว่ามีรายการอีก
- แก้อย่างไร: เพิ่ม limit/offset แบบตรวจจำนวนเต็มและช่วง คงค่าเริ่มต้นเดิม เพิ่ม has_more/next_offset จากแถวสำรองหนึ่งแถว เรียง id เมื่อเวลาเท่ากัน ใช้ tenant transaction และ RLS เดิมทุกหน้า
- ตรวจแล้ว: typecheck ทุก workspace และ production build เว็บผ่าน; ชุดตรวจ PGlite เดิมรวมกรณีใหม่ผ่าน 81 / 25 skipped / 0 failed (106 ข้อ); ตรวจ client เพิ่มหลังจากนั้นผ่าน 5 ข้อรวมการคงคำค้นภาษาไทยและตัวกรอง; PostgreSQL 16.15 เฉพาะ HTTP ลูกค้า/งานและ SQL แบ่งหน้าผ่าน 5 / 0 skipped / 0 failed ดู VERIFICATION.md
- สถานะ: เพิ่มความสามารถแบ่งหน้าที่ค้างแล้ว ไม่ได้เปลี่ยนสถานะ UAT หรือ production providers ผู้ใช้ยังไม่ต้องทดสอบเองในรอบนี้

### 2026-10-04 — สร้างเว็บเจ้าของร้าน MVP ตามคำขอให้ทำเว็บก่อน

- ทำอะไร: เพิ่ม `/shop` เป็น workspace ของเจ้าของร้านครบวงจรตาม OWNER_WEB.md และให้ `/` เปิดเว็บร้าน; `/console` คงเป็นพื้นที่ทีมแพลตฟอร์ม ใช้ session คนละชุด
- ปัญหา: บันทึกขั้น A01–D เดิมครอบคลุม API/mobile/console แต่ยังไม่มีเว็บบริหารร้านโดยเฉพาะ จึงไม่ควรสรุปว่าโปรแกรมทั้งสามฝั่งเสร็จทั้งหมด
- สาเหตุ: เว็บเดิมมีเพียง console และหน้า join ขณะที่งานร้านอยู่ในแอป Expo
- แก้อย่างไร: ทำหน้าเว็บร้านที่เชื่อม API จริง พร้อมสิทธิ์เจ้าของ สลับร้าน เมนูธุรกิจ คำแปลร่วมไทย/อังกฤษ และหน้าจอปรับตามความกว้าง ไม่ใช้ข้อมูล mock ในผลิตภัณฑ์
- ปัญหาที่แก้จากการตรวจ: ช่องวันเวลาต้องส่งค่าจาก native input ให้ state และตีความเป็นเวลาไทย; เปลี่ยนหน้าแล้ว reload ต้องคืนเส้นทางและร่าง; ไม่ให้ปิดงาน/บันทึกเครื่องระหว่างรูปกำลังอัปโหลด; งานหน้างานที่ไม่มีนัดต้องแสดงในประวัติงานเสร็จแล้ว; ร่างที่ชนเวอร์ชันงานต้องอ่านสิทธิ์/เวอร์ชันใหม่ก่อนแก้และส่งต่อ
- ตรวจหน้าจอจริงด้วยข้อมูลสังเคราะห์: สมัคร/OTP/สร้างร้าน ลูกค้าเบอร์อย่างเดียว+สถานที่ เครื่องกรอกเอง สร้าง/มอบหมายให้ตัวเอง/เลื่อนนัดเวลาไทย/เริ่มงาน กู้ร่างพร้อมรูปและวันรอบหลัง reload ปิดงาน นัดจากรอบดูแล ใบแจ้งชำระ/สลิปรอตรวจ เปิดเรื่องซัพพอร์ต สร้างร้านเพิ่ม/สลับร้าน ทีม+QR+ปิดรับคำขอ ไทย/อังกฤษ และหน้าทีม 320px ไม่ล้นจอ
- ปัญหาฐานทดสอบ: SSH หลุดระหว่างตรวจ ทำให้ API ตอบ unavailable; ร่างและ session ยังอยู่และลองใหม่สำเร็จ ปรับตัวช่วย QA ไม่ถือ connection setup ว่างไว้ และทดสอบบน cluster แยกจากร้านจริง
- ผลชุดตรวจรอบสุดท้าย: typecheck ทุก workspace ผ่าน; build API/Next.js รวมเว็บ `/shop` ผ่าน; PGlite 78 ผ่าน / 25 skipped / 0 failed; PostgreSQL 16.15 ฐานแยก 103 ผ่าน / 0 skipped / 0 failed รวม session เว็บ 4 ข้อใหม่ ดู [VERIFICATION.md](VERIFICATION.md)
- สถานะ: พัฒนาเว็บเจ้าของร้าน MVP แล้ว ผู้ใช้ยังไม่ต้องทดสอบตอนนี้ ยังไม่ใช่การยืนยัน UAT/production readiness ของทั้งระบบ; การ deploy, provider จริง และ device checks ยังอยู่ในงานถัดไป

### 2026-10-04 — ดำเนินงานค้าง: แสดงบัญชีในหน้าร่วมร้านและตรวจซ้ำ

- ทำอะไร: เพิ่มข้อความแสดงเบอร์บัญชีปัจจุบันและปุ่มออกจากระบบเพื่อใช้เบอร์อื่นในหน้าร่วมร้าน ไทย/อังกฤษ; เก็บ token ลิงก์เดิมเมื่อเปลี่ยนบัญชี
- ปัญหา: ผู้ใช้ที่ยังเข้าระบบเป็นเจ้าของอาจเข้าใจว่ากำลังสมัครช่างใหม่ ทั้งที่แอปส่งคำขอด้วยบัญชีเดิม
- สาเหตุ: หน้าร่วมร้านเดิมไม่แสดงบัญชีที่ใช้ และไม่มีทางเปลี่ยนเบอร์จากหน้าลิงก์โดยตรง
- แก้อย่างไร: แสดงเบอร์ให้ตรวจสอบก่อนส่งคำขอ และเพิ่มทางออกจากระบบกลับมาหน้าร้านเดิม; สิทธิ์และการอนุมัติยังตรวจโดย API ตามเดิม
- ตรวจแล้ว: typecheck ทุก workspace ผ่าน; PGlite 74 ผ่าน / 25 skipped / 0 failed; PostgreSQL 16.15 ฐานทดสอบแยกผ่าน 99 / 0 skipped / 0 failed (รวมสมัคร→join→approve, concurrency, service retry และ pilot journey); export Android และ iOS ผ่าน
- สถานะ: โค้ดพร้อมทดสอบบนมือถือ; ยังไม่ยืนยันกล้อง/GPS/ขอบจอ/session บนอุปกรณ์จริง รอคำตอบเรื่องมือถือพร้อมทดสอบและ URL repo

### 2026-10-04 — ทดสอบบนมือถือ Android จริง (Expo Go)

**1. ลิงก์ลงทะเบียนช่างขึ้น 404 `Cannot GET /join/...`**
- สาเหตุ: `JOIN_LINK_BASE_URL` ใน `.env` ชี้พอร์ต 3000 ซึ่งเป็น API ของ ServiceFlow ตัวเดิม หน้า `/join` ของ field-service อยู่ที่ admin พอร์ต 3001
- แก้: `.env` → `http://192.168.1.99:3001/join`; ค่า default ใน `apps/api/src/config.ts` และ `.env.example` → 3001 (f53dc55) ลิงก์ถูกสร้างจาก config ทุกครั้ง token เดิมยังใช้ได้
- สถานะ: ✅ หน้าเข้าร่วมขึ้นชื่อร้าน "Ton" แล้ว

**2. ปุ่ม "เปิดในแอป" ใช้กับ Expo Go ไม่ได้**
- สาเหตุ: ปุ่มชี้ `fieldservice://` ซึ่งมีเฉพาะแอปที่ติดตั้งจริง Expo Go รู้จักแค่ `exp://`
- แก้: ตั้งค่าได้ด้วย `NEXT_PUBLIC_APP_JOIN_URL` (default `fieldservice://join/`) เครื่อง dev ใช้ `exp://192.168.1.99:8081/--/join/` ใน `apps/admin/.env.local` (f53dc55)
- สถานะ: ✅ กดแล้วเข้าแอปหน้าขอเข้าร่วมร้าน

**3. หน้า join ค้างที่ "…" เมื่อเปิดผ่าน IP วง LAN**
- สาเหตุ: Next.js 16 บล็อกไฟล์ dev จาก origin ที่ไม่ใช่ localhost หน้าจึงไม่ hydrate และ API ต้องอนุญาต CORS ให้ origin ใหม่
- แก้: `allowedDevOrigins` จาก `DEV_ALLOWED_ORIGINS` ใน `next.config.ts`; เพิ่ม `http://192.168.1.99:3001` ใน `ADMIN_ORIGIN` ของ `.env`; `NEXT_PUBLIC_API_URL` ใน `apps/admin/.env.local` ชี้ IP วง LAN
- สถานะ: ✅ บนมือถือ / ⚠️ เบราว์เซอร์ในแอป Claude ยังเรียก API ข้าม origin ไม่ได้ (curl ยืนยันว่า header ถูก น่าจะเป็นข้อจำกัดของเบราว์เซอร์ในแอปเอง)

**4. ช่างกดเข้าร่วมแล้ว แต่รายการไม่ขึ้นที่ร้าน**
- ตรวจ: ฐานข้อมูลไม่มีคำขอเข้าร่วมใหม่และไม่มีผู้ใช้ใหม่ → คำขอไม่เคยไปถึงเซิร์ฟเวอร์
- สาเหตุที่น่าจะเป็น: ตอนนั้นแอปยังเข้าสู่ระบบเป็นเจ้าของร้าน หลัง logout ฟอร์มขอเข้าร่วมเปิดได้ถูกต้อง
- แนวทาง: ช่างต้องใช้เบอร์อื่นที่ไม่ใช่เบอร์เจ้าของ (เบอร์เดียวกัน = ผู้ใช้คนเดียวกัน) และทำ OTP ให้จบ
- ควรพิจารณาภายหลัง: ถ้าผู้ใช้ที่เข้าระบบอยู่เปิดลิงก์เข้าร่วม ควรมีข้อความบอกชัดเจน
- สถานะ: ⏳ รอทดสอบต่อ

**5. ปุ่ม "ถัดไป" จมใต้แถบนำทาง Android และปุ่มย้อนกลับชิดแถบสถานะ**
- สาเหตุ: `SafeAreaView` ของ React Native ใช้ได้กับ iOS อย่างเดียว Expo 57 บน Android แสดงผลแบบ edge-to-edge
- แก้: ติดตั้ง `react-native-safe-area-context` (~5.7.0) ใช้ `SafeAreaProvider` + `SafeAreaView` (edges ทั้ง 4 ด้าน) ใน `App.tsx` (7640470) typecheck และ bundle Android ผ่าน
- สถานะ: ⏳ รอ Reload บนมือถือยืนยัน

**6. Push ไม่ได้**
- สาเหตุ: repo ไม่มี git remote, ไม่มี `gh`
- แนวทาง: รอ URL ของ repo แล้ว `git remote add origin <URL>` และ `git push -u origin field-service-a02`
- สถานะ: ⏳

**7. ดึงรหัส OTP สำหรับทดสอบ**
- ปัญหา: ระบบตรวจสิทธิ์อัตโนมัติของ Claude ไม่อนุญาตให้ query ตาราง `auth.otp_challenges`
- แนวทาง: อ่านรหัสจาก log ของ API (`[development SMS]`) เท่านั้น ต้องรัน `fs-api` ใน session ที่ต้องการอ่าน log
- สถานะ: ✅ ย้าย `fs-api` มารันใน session ปัจจุบันแล้ว

### 2026-10-03 – 2026-10-04 — พัฒนา A01 → D (ปัญหาที่เจอระหว่างทาง)

- **เปลี่ยนทิศทางโปรดักต์** (2026-10-03): เลิกใช้แผน ServiceFlow เดิม ไปทำ `field-service` (mobile-first) ตามเอกสาร `CLAUDE_START_PROMPT_TH.md` ส่วน LINE, การให้ช่างเข้าระบบด้วยรหัสผ่าน และ DEESMSX พักไว้
- **UI แบบ prototype สีเขียวไม่สวย**: เปลี่ยนเป็นธีมน้ำเงิน (#1D4ED8), ฟอนต์ Noto Sans Thai, ไอคอน และแถบเมนูล่าง (62a9366)
- **`fs_owner` ไม่ใช่ superuser บน server2** ทำให้ `pnpm db:seed` เขียนผ่าน RLS ไม่ได้ → โหลด seed ด้วย `sudo -u postgres psql` แทน (การทำให้เป็น superuser ถูกปฏิเสธ ไม่ทำ)
- **Tunnel ไปฐานข้อมูลทดสอบหลุดบ่อย** → เปิดใหม่ `ssh -N -L 55432:127.0.0.1:5432 -L 55433:127.0.0.1:5433 uht-dev`
- **พอร์ต 3000 ชนกับ API ServiceFlow ตัวเดิม** → admin/console ของ field-service ย้ายไปพอร์ต 3001 (7a0a1ff)
- **Bash heredoc ที่มีเครื่องหมายคำพูดพังบนเครื่องนี้** → เขียนสคริปต์ด้วยเครื่องมือเขียนไฟล์แล้วรันด้วย node
- **Expo web หลุด session หนึ่งครั้งหลังรีสตาร์ท API** (ทำซ้ำไม่ได้) → ⏳ เฝ้าดูตอนทดสอบบนเครื่องจริง
