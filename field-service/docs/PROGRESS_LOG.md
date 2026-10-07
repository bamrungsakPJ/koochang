# บันทึกความคืบหน้า (Progress log)

ไฟล์นี้บันทึก **ความคืบหน้า ปัญหาที่เจอ และแนวทางการแก้ไข** ทุกครั้งที่ทำงาน
เขียนรายการใหม่ไว้บนสุดของหัวข้อ "บันทึกรายวัน" ใช้รูปแบบเดิม: ทำอะไร → ปัญหา → สาเหตุ → แก้อย่างไร → สถานะ
รายละเอียดการทดสอบอยู่ใน [VERIFICATION.md](VERIFICATION.md) เหตุผลการออกแบบอยู่ใน `DECISIONS_*.md`
สิ่งที่ต้องตัดสินใจก่อน pilot อยู่ใน [PILOT_RUNBOOK.md](PILOT_RUNBOOK.md)

---

## สถานะปัจจุบัน (อัปเดตล่าสุด 2026-10-07 — APK 0.2.7 ทดสอบบนมือถือผ่าน)

### งานที่ทำและแก้ไขแล้ว

- **ระบบหลัก**: พัฒนาฝั่ง API, แอปมือถือ, เว็บเจ้าของร้าน `/shop` และ console `/console` แล้ว ครอบคลุมบัญชี/ร้าน/ทีม ลูกค้า/สถานที่ อุปกรณ์ งาน ผลบริการ รอบดูแล สมาชิก การชำระเงิน ซัพพอร์ต และไทย/อังกฤษ การมีโค้ดไม่ได้หมายถึงผ่านการทดสอบผู้ใช้จริงครบทุกส่วน
- **Console**: เพิ่มการตั้งค่าบัญชีรับเงิน Stripe, EasySlip, DeeSMSx และ Anthropic พร้อมเปิด/ปิดบริการ เก็บกุญแจเข้ารหัส รวมถึงทีมผู้ดูแล แพ็กเกจ นโยบาย ประกาศ คิวตรวจสอบ รายงาน และบัญชีส่วนตัว ดู [CONSOLE.md](CONSOLE.md)
- **เว็บร้าน**: ทำหน้าใช้งานหลักและเพิ่มแบ่งหน้าลูกค้า/งานครั้งละ 50 รายการแล้ว ดู [OWNER_WEB.md](OWNER_WEB.md); การแบ่งหน้านี้ยังไม่ได้เพิ่มบนมือถือ
- **การชำระเงิน**: มีตรวจสลิป EasySlip อัตโนมัติ เมื่อผ่านให้บันทึกยอด/รอบสมาชิกและเปิดสิทธิ์ ส่วนมีปัญหาให้แอดมินตรวจ; มี Stripe QR PromptPay/บัตรเครดิตและยืนยันยอดจาก server ก่อนเปิดสิทธิ์ ยังต้องตรวจด้วยการชำระเงินจริง
- **เข้าสู่ระบบ**: ใช้เบอร์โทรและรหัสผ่าน; OTP สำหรับสมัครและลืมรหัสผ่าน เพิ่มการบันทึก session แบบ atomic และ biometric แบบเลือกเปิดแล้ว ไม่เก็บรหัสผ่านไว้ในเครื่อง; biometric ปลดล็อกตอนเริ่มแอป ยังไม่ล็อกใหม่เมื่อกลับจาก background
- **เพิ่มลูกค้า**: เบอร์โทรบังคับ ชื่อลูกค้าไม่บังคับ เพิ่มดาวสีแดงตามช่องจำเป็นและปุ่มใช้ตำแหน่งปัจจุบัน พร้อมพิกัด/ความแม่นยำ ขอสิทธิ์ foreground เฉพาะตอนกด และบันทึกพร้อมลูกค้าใน transaction เดียว
- **ส่งรูปและ OCR**: แก้การส่งรูปป้าย/รูปงานเป็น native bytes เพิ่มภาพตัวอย่าง สถานะอัปโหลด/อ่านรูป ผลยี่ห้อ/รุ่น/Serial ข้อผิดพลาดและลองใหม่ ป้องกันผลรูปเก่าทับรูปใหม่ และอธิบายกรณีเซิร์ฟเวอร์ยังไม่ตั้งค่า AI; ยังต้องยืนยันบนโทรศัพท์จริง
- **ลดค่าใช้จ่าย AI**: ใช้ `claude-haiku-4-5-20251001`, จำกัด 512 tokens, ปิด thinking และไม่มี fallback ไปโมเดลแพง Prompt อ่านเฉพาะ brand/model/serial_number คงตัวอักษรและเลขศูนย์ ไม่เดาข้อมูลที่อ่านไม่ได้ และไม่ทำตามคำสั่งในภาพ ทดสอบ Anthropic จริงด้วยภาพสังเคราะห์อ่านตรงครบ 3 ช่องประมาณ 4 วินาที ยังไม่ใช่ผลทดสอบรูปถ่ายจริง
- **แบรนด์**: ใช้ คู่ช่าง / KooChang, package/bundle `com.koochang.app`, deep link `koochang://` และนำโลโก้ไปใช้แล้ว บริษัทไทย “บริษัท ไอ ที อีส มี จำกัด” อังกฤษ “IT IS ME Co., Ltd.”; เลขเวอร์ชันย้ายไปอยู่ บัญชี → เกี่ยวกับแอป (และลิงก์เล็กใต้หน้าเข้าสู่ระบบ) ไม่แสดงหน้าแรก ตั้งแต่ 0.2.6
- **Build Android ในเครื่อง**: ติดตั้ง JDK 17, SDK 36, Build Tools 36.0.0, NDK และ CMake บนไดรฟ์ D แก้ปัญหา dependency/พาธยาว และ build Release APK ล่าสุด **0.2.7 / Build 9** พร้อมลายเซ็นเดิม (cert SHA-256 4eed9485…) ตรวจ package/version/certificate/API และเนื้อหา bundle แล้ว ไฟล์ `output/builds/apk/KooChang-0.2.7-build9.apk`; รองรับ Android 7.0 ขึ้นไป (minSdk 24, targetSdk 36); วิธี build ซ้ำ: คัดลอกไฟล์ที่เปลี่ยนไป D:\kc, build i18n ใน D:\kc, แก้ versionCode/versionName ใน `D:\kc\apps\mobile\android\app\build.gradle` ให้ตรง app.json แล้วรัน gradlew ด้วย `Start-Process` (ไม่ใช้ `*>` หรือ `cmd /c` เพราะล้มในรอบ 0.2.6) ใช้เวลาประมาณ 1 นาทีเมื่อ cache ครบ ดู [ANDROID_LOCAL_BUILD.md](ANDROID_LOCAL_BUILD.md)
- **Git**: origin = https://github.com/bamrungsakPJ/koochang (private) push แล้วทั้ง main และ field-service-a02 (2026-10-07); Claude push เองไม่ได้ ผู้ใช้เป็นคนรัน git push
- **Staging**: server2 อัปเดต API/worker ถึง `8349bae`, migration 027, มี HTTPS ที่ [console/เว็บร้าน](https://app-staging.koochang.com/console) และ [API](https://api-staging.koochang.com); ตั้งค่า Anthropic key แล้ว โค้ดอยู่ branch `field-service-a02` ยังไม่มี git remote
- **ทดสอบบนมือถือจริงโดยผู้ใช้ (2026-10-07, APK 0.2.7)**: ผ่าน — ปุ่มย้อนกลับ Android ถอยตามหน้าในแอป/กดซ้ำเพื่อออก; ก่อนหน้านี้ผู้ใช้พบและเราแก้ (1) ค้นเบอร์ไม่เจอแล้วไปต่อไม่ได้ → เพิ่มลูกค้าใหม่จากหน้าเลือกลูกค้าแล้วไปเปิดงานต่อ (2) รูปโปรไฟล์หน้าแรกกดไม่ได้ → ไปแท็บบัญชี; ปุ่มลอย +/− ขอบขวาในภาพหน้าจอผู้ใช้ไม่ใช่ของแอป (ปุ่มซูม/การช่วยเหลือของเครื่อง)
- **ผลตรวจ**: มีผล typecheck/build และชุดทดสอบที่เกี่ยวข้องบันทึกในรายวันและ [VERIFICATION.md](VERIFICATION.md) ตัวเลขทดสอบแต่ละรอบเป็นผล ณ เวลานั้น ไม่ใช่การรันทดสอบทั้งหมดใหม่ในวันที่ 2026-10-07

### งานที่ยังค้างและลำดับทำต่อ

1. มือถือยังไม่มีโหลดหน้าถัดไป ลูกค้าเริ่มต้น 30 รายการ งาน 200 รายการต่อคำค้น/ตัวกรอง; วันนัดเลือกได้วันนี้และอีก 6 วัน เวลาเป็นชุดตายตัว
2. แยกร่างผลบริการตามผู้ใช้สำหรับโทรศัพท์ที่ใช้ร่วมกัน; offline ปัจจุบันมีเฉพาะร่าง ยังไม่มี cache ข้อมูลเครื่อง/คิวรูปส่งเมื่อกลับออนไลน์
3. ตรวจหรือปรับการส่งสลิปบนมือถือที่ยังใช้ Blob ให้สอดคล้องกับรูปป้าย ยังไม่มีหลักฐานยืนยันว่าการส่งสลิปนี้เสียจริง
4. ตั้งค่า Firebase สำหรับ Android APK และ worker เพื่อรับ Push จริง; iOS Push ยังไม่รองรับ
5. ยืนยัน/ปรับ SMS staging ซึ่งปัจจุบันเลือก THSMS ให้ตรงกับ DeeSMSx ที่ผู้ใช้เลือก และทดสอบ OTP จริง
6. ทดสอบ Android APK ล่าสุด (0.2.7) บนโทรศัพท์จริงต่อ — ผ่านแล้ว: ปุ่มย้อนกลับ; ยังเหลือ: หน้าเกี่ยวกับแอป (ยืนยันเลข Build 9 บนเครื่อง และปุ่มส่งข้อมูลรุ่น), เปิดงานจากลูกค้าใหม่ครบวงจร, ถ่าย/เลือกรูปและผล OCR, GPS/สิทธิ์, session หลังเปิดใหม่/อัปเดต, biometric, ร่าง/เน็ตหลุด, keyboard/ขนาดตัวอักษร และการชำระเงิน/กลับเข้าแอป
7. ทดสอบ EasySlip/Stripe จริงตามโหมดที่พร้อม รวมทั้งเปิดสิทธิ์ทันทีและกรณีผิดพลาด; ทำ UAT เว็บร้าน/console และวัดความแม่น OCR ด้วยรูปถ่ายจริง
8. Build/ทดสอบ iOS และเตรียมปล่อยร้านแอป; เตรียม production, backup นอกเครื่อง, นโยบายความเป็นส่วนตัว/ข้อตกลงการใช้งานเป็นหน้าเว็บสาธารณะ (แล้วเพิ่มลิงก์ในหน้าเกี่ยวกับแอป) และ git remote/CI ตามความพร้อม

ผลตรวจรายละเอียดอยู่ใน [MOBILE_STATUS_2026-10-07.md](MOBILE_STATUS_2026-10-07.md) รายการค้างข้อ 1–5, 7–8 ยังไม่ได้แก้ รายวันด้านล่างเก็บประวัติตามเวลา จึงอาจมีสถานะเก่าที่ถูกแก้แล้ว

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

### 2026-10-07 — ตรวจ Google Search Console
- ผู้ใช้ตั้ง Search Console แบบ Domain property: TXT google-site-verification อยู่ใน DNS แล้ว ✅; ส่ง sitemap แล้ว สถานะ "Couldn't fetch" (ค่าที่ GSC แสดงบ่อยทันทีหลังส่ง)
- ตรวจฝั่งเว็บ: /sitemap.xml 200 application/xml, ดึงด้วย UA Googlebot ได้ 200 (Cloudflare ไม่บล็อก), robots.txt ชี้ sitemap และกัน /shop /console /join/
- แก้ความเข้าใจเดิม: /privacy /terms เป็น index อยู่แล้ว (legalReady=true มีชื่อ/ที่อยู่บริษัทครบ) ข้อความเรื่อง noindex ในบันทึกก่อนหน้าล้าสมัย
- sitemap.ts: ใส่หน้ากฎหมายเฉพาะเมื่อ legalReady และเพิ่ม changefreq/priority หน้าแรก (ผลลัพธ์ตอนนี้เท่าเดิม ยังไม่ต้อง deploy)

### 2026-10-07 — Backup นอกเครื่องไป Cloudflare R2 (เข้ารหัส)
- ตรวจของเดิมบน server2: dump DB ทุกวัน 02:30 + สำเนา /data3 ทำงาน (มีครบ 4 รอบ), restore check ทุกอาทิตย์; ไฟล์ media 107 ไบต์ไม่ใช่บั๊ก — รูปแรกบน staging อัปโหลด 07:22 วันนี้ หลังรอบ backup; ทั้งหมดยังอยู่เครื่องเดียว
- ผู้ใช้เลือก Cloudflare R2
- ทำ: backup.sh เพิ่ม OFFSITE_RCLONE (rclone copy ไฟล์รอบนั้น + ลบบน R2 ที่เก่ากว่า OFFSITE_RETENTION_DAYS=90); infra/backup/setup-offsite-r2.sh สร้าง remote r2 + r2crypt (เข้ารหัสชื่อและเนื้อหา) รับ key แบบซ่อน ไม่ผ่าน argv, ทดสอบ round trip และตรวจว่า R2 เห็นแต่ชื่อที่เข้ารหัส, สุ่ม crypt password แสดงครั้งเดียว; PILOT_RUNBOOK เพิ่มวิธีตั้งค่าและกู้คืนจาก R2
- ตรวจ: bash -n ผ่าน; server2 มี rclone 1.60.1 ใน apt (รองรับ provider Cloudflare และ --obscure) ยังไม่ได้รันจริง
- รอผู้ใช้: สร้าง bucket + API token ใน Cloudflare, ติดตั้ง rclone, รัน setup, เพิ่ม OFFSITE_RCLONE ใน cron (Claude เขียนบนเซิร์ฟเวอร์ไม่ได้)
- รันจริงรอบแรก: (1) 403 AccessDenied — bucket จริงชื่อ koochang ไม่ใช่ koochang-backups (token ผูก bucket เดียว) (2) 501 NotImplemented — PUT สำเร็จ แต่ rclone 1.60 ตามด้วย HEAD ?versionId= ที่ R2 ไม่รองรับ → ตั้ง no_head true (R2 ยังตรวจ Content-MD5 ตอน PUT); สคริปต์ล้มหลังสร้าง remote แล้ว crypt password ไม่ได้แสดง จึงต้องลบ remote แล้วรันใหม่ → เพิ่ม trap ลบ remote เมื่อขั้นใดล้ม; ค่า default bucket เปลี่ยนเป็น koochang
- ตรวจด้วย remote ชั่วคราว + --s3-no-head: rcat/cat ผ่าน crypt ตรงกัน, copy --include "*-<stamp>.*" ส่งเฉพาะไฟล์รอบนั้น, R2 เห็นแต่ชื่อเข้ารหัส; ลบไฟล์ทดสอบทั้งหมด bucket ว่าง
- ✅ ผู้ใช้รัน setup ใหม่ผ่าน (r2 no_head, r2crypt → r2:koochang/staging, conf 600 root), เพิ่ม OFFSITE_RCLONE=r2crypt: ใน /etc/cron.d/field-service-staging (สำรอง /root/field-service-staging.cron.bak-20261007) และสั่ง backup ทดสอบ 20261007T095639Z
- ตรวจ: บน R2 มี db 1.35 MB / media 2.17 MB / sums ชื่อดิบเข้ารหัส; ดาวน์โหลดผ่าน r2crypt แล้ว sha256sum -c ผ่านทั้งสองไฟล์, db ตรงกับสำเนาในเครื่องทุกไบต์, media 14 รายการ, pg_restore -l อ่านได้ 72 TABLE DATA
- เก็บ crypt password ไว้นอกเซิร์ฟเวอร์ (ผู้ใช้เก็บเอง) — ไม่มีในแชท/repo

### 2026-10-07 — git remote
- ผู้ใช้สร้าง repo private https://github.com/bamrungsakPJ/koochang (API สาธารณะตอบ 404 = private) และตั้ง remote origin แล้ว
- ก่อน push สแกนประวัติทั้งหมด 124 commit: ไม่มี .env / keystore / private key / API key
- ปัญหา: Claude push เองไม่ได้ (auto mode classifier บล็อก) → ผู้ใช้รัน git push -u origin main field-service-a02 เอง
- ปัญหาตอน push: (1) "Repository not found" — credential เก่าใน Git Credential Manager ไม่มีสิทธิ์ repo private → logout แล้ว login ใหม่ (2) main ถูก reject เพราะ GitHub สร้าง README (5b822fc "# koochang") ไว้ ไม่มีประวัติร่วม → git push --force-with-lease=main:5b822fc ทับ
- ✅ main 47aa9f9 และ field-service-a02 ตรงกับ origin; ทั้งสอง branch track origin แล้ว

### 2026-10-07 — commit งานเว็บไซต์สาธารณะทั้งชุด
- commit 72394a5: landing, product showcase + screenshots, /privacy /terms, robots/sitemap, og-image, PublicCatalogController + migration 028 + test, เอกสาร LEGAL_REVIEW/WEBSITE_SCREENSHOTS, ภาพหลักฐานใน output/
- ไม่ commit ไฟล์ deploy output/*.tar (สำเนาของซอร์ส) เพิ่มใน .gitignore
- working tree สะอาด; ยังไม่มี git remote

### 2026-10-07 — ตรวจหน้าทดลองฟรีบนเว็บจริง และแก้ภาษาหน้าสมัคร
- ตรวจ https://koochang.com หลังผู้ใช้ deploy website-trial: title ใหม่, lowPrice 0, badge/ปุ่มเมนู, แถบทดลอง 14 วัน (ช่าง 3 คน 5 GB), ปุ่มแพ็กเกจ 3 ใบ → /shop?signup=1, FAQ ข้อแรก, og-image 200 ✅
- ปัญหา: /shop?signup=1 เปิดหน้าสร้างร้านถูก แต่เป็นภาษาอังกฤษ — สาเหตุ owner web เลือกภาษาตาม navigator.language (เบราว์เซอร์ en-US) ทั้งที่มาจากหน้าแรกภาษาไทย; คนไทยจำนวนมากตั้งมือถือเป็นอังกฤษ
- แก้: OwnerApp อ่าน ?lang= เมื่อยังไม่เคยเลือกภาษาไว้ (ลำดับ: ภาษาที่บันทึกไว้ → ?lang → เบราว์เซอร์; ผู้ใช้ที่ login ใช้ preferred_language ตามเดิม); ลิงก์จากหน้าแรกทั้งหมดเติม lang=th; ปุ่มใน showcase เปลี่ยนเป็น "ทดลองใช้ฟรี 14 วัน" ไปหน้าสมัคร
- ตรวจ: typecheck/next build ผ่าน; Playwright locale en-US: /shop?signup=1&lang=th → "สร้างร้าน", /shop เปล่า → อังกฤษตามเดิม
- Deploy: output/website-lang-20261007.tar (landing.tsx, product-showcase.tsx, shop/OwnerApp.tsx; ไฟล์บน server ตรงกับฉบับก่อนแก้)
- ผู้ใช้ deploy แล้ว ✅ ตรวจเว็บจริงด้วย Playwright locale en-US: ลิงก์หน้าแรก /shop?signup=1&lang=th 10 จุด, /shop?lang=th 2 จุด, ไม่เหลือ /shop เปล่า; ปุ่ม showcase "ทดลองใช้ฟรี 14 วัน"; กดปุ่มหลักแล้วได้หน้า "สร้างร้าน" ภาษาไทย; /shop ตรง ๆ ยังเป็นภาษาตามเบราว์เซอร์

### 2026-10-07 — เน้น "ทดลองใช้ฟรี 14 วัน" บนหน้าแรก
- ทำอะไร: ปุ่มสีส้มบนเมนู "ทดลองฟรี 14 วัน" (เข้าสู่ระบบเป็นลิงก์ข้อความ), badge เหนือ H1, CTA หลักเปลี่ยนเป็น "ทดลองใช้ฟรี 14 วัน" พร้อมแถวลดความกังวล (ไม่ต้องใช้บัตรเครดิต · ไม่ตัดเงินอัตโนมัติ · ใช้ได้ทุกฟีเจอร์), กล่องทดลองในส่วนราคาเป็นแถบเด่นเลข 14 วัน, ปุ่มทุกแพ็กเกจเป็น "ทดลองฟรี 14 วัน", FAQ เงื่อนไขทดลอง, CTA ท้ายหน้าใหม่, title/description/JSON-LD (lowPrice 0) และ og-image ใหม่
- ปุ่มทดลองลิงก์ /shop?signup=1 → OwnerApp เปิดหน้า "สร้างร้าน" ทันที (เดิมผู้ใช้ต้องหาเองในหน้าเข้าสู่ระบบ)
- ข้อความยืนยันจากโค้ด: trial plan ราคา 0 เริ่มอัตโนมัติด้วย trigger เมื่อสร้างร้าน (003_entitlements), ไม่มีการตัดเงินแบบ recurring, หมดอายุแล้วเป็น read-only ไม่ลบข้อมูล; ตัวเลข 14 ในข้อความ static เป็นค่าคงที่ TRIAL_DAYS ต้องแก้ตามถ้าเปลี่ยน trial_days
- ตรวจ: typecheck/next build ผ่าน; ภาพ desktop/375px ไม่มี overflow; /shop?signup=1 ขึ้นหัวข้อ "สร้างร้าน"
- ข้อควรระวัง: SMS OTP ยังไม่พร้อม (รอ DeeSMSx) ผู้เยี่ยมชมจริงจะสมัครไม่สำเร็จจนกว่าจะตั้ง SMS
- Deploy: output/website-trial-20261007.tar (เพิ่ม shop/OwnerApp.tsx; ไฟล์บน server ตรงกับ HEAD ก่อนแก้)

### 2026-10-07 — ปรับข้อความหน้าแรกด้าน UX/SEO
- ทำอะไร: แพ็กเกจที่ไม่มีที่นั่งช่างแสดง "เจ้าของรับงานเอง ไม่มีช่างในทีม" แทน "ช่าง 0 คน"; ป้ายแพ็กเกจตัดสินจากจำนวนที่นั่ง (เดิมป้ายซ้ำกัน); รายปีแสดงราคาเฉลี่ยต่อเดือนและยอดประหยัด แทนบรรทัดที่ซ้ำราคา; H1/title/description ใส่คีย์เวิร์ด โปรแกรมจัดการงานช่าง, ร้านแอร์, ล้างแอร์, งานซ่อม, งานติดตั้ง; แถบกลุ่มลูกค้าและ FAQ ร้านแอร์/ช่างคนเดียว/อุปกรณ์ (Android 7.0+); ตัดลิงก์ /console จาก footer สาธารณะ; เพิ่ม og-image 1200x630, twitter summary_large_image, JSON-LD (legalName, logo, Web+Android, AggregateOffer 290–1,290)
- ปัญหา: ฐาน dev ไม่มี migration 027–028 ทำให้ /v1/catalog ใน dev ล้ม (padmin.public_catalog ไม่มี) → รัน pnpm db:migrate บนฐาน dev; ฐาน dev มีแพ็กเกจคนละรหัสกับ staging จึงเปลี่ยนป้ายเป็นอิงจำนวนที่นั่ง; H1 บนมือถือตัดคำเหลือ "ช่าง" บรรทัดเดียว → ห่อวลีด้วย inline-block
- ตรวจ: admin typecheck และ next build ผ่าน; dev 375px ไม่มี horizontal overflow; รายปียังไม่ได้ตรวจใน dev (ฐาน dev ไม่มีแพ็กเกจรายปี) ต้องตรวจหลัง deploy
- ราคาใน description/JSON-LD เป็นค่าคงที่ ต้องแก้ตามเมื่อเปลี่ยนราคาใน console
- Deploy: ผู้ใช้รัน output/website-seo-20261007.tar บน server2 แล้ว (backup ไฟล์เดิม /data/field-service/staging/backups/website-before-seo-20261007.tar) ✅ ตรวจ https://koochang.com: title/og:image/twitter large/JSON-LD ใหม่, og-image.png 200, ไม่มีลิงก์ /console; แพ็กเกจรายเดือน 3 ใบป้ายถูก; รายปี ฿2,900/5,900/12,900 เฉลี่ย ฿242/492/1,075 ต่อเดือน ประหยัด ฿580/1,180/2,580 ถูกต้อง; มี trial 14 วัน

### 2026-10-07 — โดเมน koochang.com: www และราคาแพ็กเกจบนหน้าแรก
- ปัญหา 1: เครื่อง dev เปิด koochang.com ไม่ได้ — สาเหตุ เราเตอร์ 192.168.1.1 จำคำตอบเก่า (SOA serial เก่า) ก่อนเพิ่ม record root; DNS สาธารณะถูกต้อง หายเองตาม TTL ✅
- ปัญหา 2: www.koochang.com ไม่มี record — ผู้ใช้เพิ่ม CNAME www → koochang.com (Proxied) และ Redirect Rule ใน Cloudflare (Claude แก้ DNS เองไม่ได้ ถูกบล็อก) รอบแรก rule ไม่มี /* และปลายทางเป็นข้อความ concat(...) ตรงตัว จึงได้ 530/1016 → แก้เป็น https://www.koochang.com/* → https://koochang.com/${1} 301 + preserve query ✅ ตรวจ / และ /privacy?x=1 ได้ 301 ถูกต้อง
- ปัญหา 3: หน้าแรกโหลดแพ็กเกจไม่ได้ — สาเหตุ CORS: ADMIN_ORIGIN ใน /etc/field-service/staging.env มีแค่ app-staging → ผู้ใช้รันเอง (Claude เขียนไฟล์บนเซิร์ฟเวอร์ไม่ได้) เพิ่ม https://koochang.com, backup staging.env.bak-20261007, pm2 restart fs-staging-api --update-env ✅ ตรวจ header ให้ koochang.com และ app-staging, origin อื่นไม่ได้ header; หน้าแรกแสดง ฿290/฿590/฿1,290

### 2026-10-07 — ตัดสินใจปล่อย closed beta บน server2
- ทำอะไร: ผู้ใช้ถามว่าปล่อย beta ก่อนได้ไหม สรุปว่าได้ เป็น closed beta Android กับร้านจำนวนน้อย แจก APK เอง (ไม่รอ Play/D-U-N-S) และผู้ใช้เลือกใช้ server2 ชุด staging เดิมเป็นเซิร์ฟเวอร์ beta ไม่แยกเครื่อง
- อัปเดตจากผู้ใช้ (2026-10-07): SMS จะใช้ DeeSMSx — รอผู้ใช้สมัคร/ส่งข้อมูลก่อน ไม่ทดสอบ THSMS ต่อ; หน้า /privacy และ /terms ขึ้นบน staging แล้ว (ตรวจ HTTPS ตอบ 200)
- สถานะสิ่งที่ต้องมีก่อนแจกร้านแรก: (1) OTP ส่งถึงเบอร์จริง — ยังไม่ทดสอบ (staging ใช้ THSMS) (2) นโยบายความเป็นส่วนตัว/ข้อตกลง — มีหน้า /privacy /terms ในเครื่องแต่ยังไม่ commit และยังไม่ deploy (staging ตอบ 404) ต้องให้ผู้ใช้ตรวจเนื้อหา (3) backup — มีรายวันไป /data และ /data3 พร้อม restore check แต่ยังอยู่เครื่องเดียวกัน ยังไม่มีปลายทางนอกเครื่อง (4) git remote — ยังไม่มี (5) ช่วง beta ใช้ฟรี/trial — รอผู้ใช้ยืนยัน (6) ช่องทางรับปัญหา — ยังไม่กำหนด

### 2026-10-07 — ผู้ใช้ทดสอบ 0.2.7 บนมือถือผ่าน และสรุปก่อนเคลียร์แชท
- ผู้ใช้ติดตั้ง APK 0.2.7 / Build 9 และยืนยันว่าทดสอบแล้วโอเค (ปุ่มย้อนกลับ Android ซึ่งเป็นการแก้ล่าสุด)
- งานรอบแชทนี้ (2026-10-06 ถึง 07) เรียงตามเวลา: เพิ่มลูกค้าใหม่จากหน้าเลือกลูกค้าเมื่อค้นไม่เจอ (3dd8d21) → APK 0.2.1 บน EAS (ถูกแทนด้วยรุ่นใหม่แล้ว) → ออกแบบตำแหน่งเลขเวอร์ชัน: บัญชี → เกี่ยวกับแอป + ลิงก์ใต้หน้าเข้าสู่ระบบ (fe95cf1, APK 0.2.6/8) → รูปโปรไฟล์หน้าแรกไปแท็บบัญชี (d6a3673) → ปุ่มย้อนกลับ Android (82e7212, APK 0.2.7/9)
- ข้อมูลที่ตอบผู้ใช้: แอปติดตั้งได้ Android 7.0 ขึ้นไป (minSdk 24, targetSdk 36, รองรับ arm64/armv7/x86/x86_64)
- ไฟล์ APK ล่าสุด: `output/builds/apk/KooChang-0.2.7-build9.apk`; staging ไม่ต้อง deploy ใหม่ในรอบนี้ (เปลี่ยนเฉพาะแอปมือถือ)
- เพิ่ม launch config `fs-mobile-web-alt` (Expo web พอร์ต 8082) ใน .claude/launch.json สำหรับตรวจหน้าจอบนเว็บเมื่อพอร์ต 8081 ถูกใช้
- งานถัดไป: ดู "งานที่ยังค้างและลำดับทำต่อ" ด้านบน

### 2026-10-07 — ปุ่มย้อนกลับ Android ปิดแอปทันที
- ปัญหา (ผู้ใช้ทดสอบบนมือถือ): กดปุ่มย้อนกลับของ Android แล้วแอปปิดไปเลย ไม่ว่าอยู่หน้าไหน
- สาเหตุ: แอปใช้ route state ของตัวเอง ไม่มี BackHandler ระบบจึงถือว่าไม่มีหน้าให้ย้อนและปิดแอป
- แก้ (ไม่ปิดปุ่มย้อนกลับ เพราะขัดความเคยชินผู้ใช้และแนวทาง Android): `Screen` ที่มีลูกศรย้อนกลับลงทะเบียนตัวเองใน back stack ปุ่มย้อนกลับจึงทำงานเหมือนกดลูกศรบนจอ; แท็บงาน/ลูกค้า/ทีม/บัญชี กดย้อนกลับไปหน้าแรก; หน้าแรกและหน้าเริ่มต้นต้องกดซ้ำภายใน 2 วินาทีจึงออก พร้อม Toast "กดย้อนกลับอีกครั้งเพื่อออกจากแอป" (th/en)
- ตรวจ: mobile typecheck ผ่าน, i18n 4/4 ผ่าน; รวมกับรูปโปรไฟล์กดได้ เป็น 0.2.7 / Build 9
- Build สำเร็จ 59 วินาที: `output/builds/apk/KooChang-0.2.7-build9.apk` ตรวจ version 0.2.7 / versionCode 9, bundle มีโค้ดใหม่, certificate ตรงเดิม (4eed9485…); ยังไม่ได้ทดสอบบนมือถือ

### 2026-10-07 — รูปโปรไฟล์บนหน้าแรกกดไม่ได้
- ปัญหา (ผู้ใช้ทดสอบบนมือถือ 0.2.6): วงกลมโปรไฟล์ข้างกระดิ่งในหัวหน้าแรกดูเหมือนปุ่มแต่กดไม่ได้
- สาเหตุ: Home แสดง Avatar ใน View ธรรมดา ไม่มี onPress
- แก้: เปลี่ยนเป็น Pressable ไปแท็บบัญชี (accessibility label "บัญชี", จางลงเมื่อกด) ตามแบบแผนแอปทั่วไป
- สถานะ: mobile typecheck ผ่าน; ยังไม่ได้ build APK ใหม่หรือทดสอบบนมือถือ

### 2026-10-07 — วางเลขเวอร์ชันแอป: บัญชี → เกี่ยวกับแอป (ไม่แสดงหน้าแรก)
- ทำอะไร: ผู้ใช้ต้องการดูเวอร์ชันได้เมื่อต้องการแต่ไม่แสดงหน้าแรก ออกแบบและอนุมัติแล้ว: แถว "เกี่ยวกับแอป" ล่างสุดของแท็บบัญชี (กลุ่มเดียวกับซัพพอร์ต) แสดงเลขเวอร์ชันสีจางท้ายแถว และลิงก์ตัวเล็ก "เกี่ยวกับแอป" ใต้หน้าเข้าสู่ระบบ สำหรับกรณีเข้าระบบไม่ได้
- หน้าเกี่ยวกับแอป (`apps/mobile/src/screens/about.tsx`): โลโก้ ชื่อ เวอร์ชัน/Build จาก manifest ที่ติดตั้ง, ป้าย "ทดสอบ (staging)" เฉพาะเมื่อ API ไม่ใช่ระบบจริง, รุ่น Android, ปุ่ม "ส่งข้อมูลรุ่น" (Share sheet ของระบบ คัดลอกหรือส่ง LINE ได้ ไม่เพิ่ม native dependency expo-clipboard), ชื่อบริษัทด้านล่าง; th/en
- ไม่ใส่ลิงก์ข้อตกลง/นโยบายความเป็นส่วนตัว เพราะยังไม่มีหน้าเผยแพร่ (ต้องมีก่อนขึ้น Play Store)
- ตรวจ: mobile typecheck ผ่าน, i18n test 4/4 ผ่าน; เปิดบนเว็บ (Expo web) หน้าเข้าสู่ระบบมีลิงก์ About และหน้า About แสดงเวอร์ชัน/ป้ายทดสอบ/บริษัทถูกต้อง (บนเว็บไม่มีเลข Build เป็นปกติ); ยังไม่ได้ตรวจแท็บบัญชีหลังเข้าระบบและบนมือถือจริง
- เวอร์ชัน 0.2.6 / Build 8; build APK ในเครื่องที่ D:\kc (คัดลอกไฟล์ที่เปลี่ยน + แก้ versionCode/versionName ใน android/app/build.gradle)
- Build สำเร็จ: `output/builds/apk/KooChang-0.2.6-build8.apk` (75.7 MB) ตรวจใน APK แล้ว: app.config version 0.2.6 / versionCode 8, bundle มีข้อความใหม่และ API staging, certificate SHA-256 ตรงกับ 0.2.5 (ติดตั้งทับได้); ยังไม่ได้ติดตั้งบนมือถือจริง
- ปัญหา build: (1) env script ตั้ง `$ErrorActionPreference='Stop'` ทำให้คำเตือน SDK XML v4 บน stderr หยุด gradle ตั้งแต่ต้น (2) `cmd /c` หา gradlew.bat ไม่เจอหลัง env script; แก้โดยใช้ `Start-Process -FilePath <path เต็ม>\gradlew.bat -RedirectStandardOutput/-RedirectStandardError -Wait` รอบนี้ใช้เวลา 9 วินาทีเพราะ native cache ครบ

### 2026-10-07 — รวบรวมงานที่ทำและแก้ไขแล้วในสถานะปัจจุบัน

- ทำอะไร: รวบรวมระบบหลัก console/เว็บร้าน การชำระเงิน ลูกค้า/GPS ส่งรูป/OCR session/biometric แบรนด์ และ local Android build พร้อมสถานะ staging ลงหัวไฟล์
- ปัญหา: สรุปเดิมปะปนสถานะเก่า เช่น ยังไม่มีโดเมน/key, APK 0.2.2, migration 024 และโค้ดมือถือครบทั้งหมด
- สาเหตุ: รายวันอัปเดตแล้ว แต่หัวข้อสถานะปัจจุบันและงานถัดไปยังมีข้อมูลจากหลายช่วงงาน
- แก้อย่างไร: แทนที่สรุปเก่าด้วยงานที่ทำจริงและข้อจำกัดล่าสุด คงประวัติรายวัน ระบุชัดว่ารายการค้างจากการตรวจยังไม่ได้แก้
- สถานะ: บันทึกครบตามข้อมูลที่ตรวจได้ ไม่ได้แก้โค้ด ทดสอบอุปกรณ์หรือ build ใหม่ในรอบนี้


### 2026-10-07 — ตรวจสถานะแอปมือถือและแยกงานค้างจริง

- ทำอะไร: ตรวจโค้ด mobile, ขีดจำกัด API, แหล่ง build และค่าผู้ให้บริการบน staging; บันทึกผลใน MOBILE_STATUS_2026-10-07.md
- ปัญหา: เอกสารเก่าระบุโค้ดครบ แต่ mobile ยังไม่มีโหลดเพิ่มและวันนัดอิสระ; offline/Push ยังไม่ครบ และ SMS staging เลือก THSMS
- สาเหตุ: หน้ามือถือไม่ได้ส่ง pagination, picker กำหนดวัน/เวลาตายตัว, ร่างเก็บเฉพาะข้อมูล local และ provider config ไม่ครบ/ต่างจากที่เลือก
- แก้อย่างไร: บันทึกหลักฐาน แยกงานโค้ด การตั้งค่า และการทดสอบจริง พร้อมลำดับงานถัดไป ไม่เปลี่ยน provider หรือโค้ดในงานตรวจสถานะ
- สถานะ: ตรวจเสร็จ ยังต้องแก้รายการในรายงานและ UAT; ไม่ได้ build ใหม่ ไม่ได้ทดสอบบนโทรศัพท์หรือส่ง SMS/ชำระเงินจริงในรอบนี้


### 2026-10-06 — Prompt อ่านเฉพาะข้อมูลป้ายเครื่อง
- ปรับ system prompt ระบุ brand/model/serial_number พร้อมชื่อป้ายกำกับไทย/อังกฤษ คงตัวอักษร ตัวพิมพ์ เลขศูนย์นำหน้า และเครื่องหมาย ห้ามเดา O/0, I/1 หรือใช้รหัส/ค่าพิกัด/วันที่แทนเลขเครื่อง
- ข้อมูลไม่มี อ่านไม่ชัด หรือแยกเครื่องใน/นอกไม่ได้ ให้คืนค่าว่าง; ข้อความในภาพถือเป็นข้อมูลไม่ใช่คำสั่ง; ส่งกลับ JSON แค่ 3 ช่อง ไม่มีคำอธิบาย confidence หรือ raw_text
- คง Haiku/512 tokens/no fallback; API build และ provider tests 4 ผ่าน; deploy staging 8349bae + API/worker restart + ready ผ่าน; ทดสอบ Anthropic จริงด้วยป้ายสังเคราะห์เดิม อ่าน 3 ช่องตรงครบใน 4.044 วินาที (ยังไม่ใช่รูปถ่ายจริง); เป็นฝั่งเซิร์ฟเวอร์ ไม่ต้อง rebuild APK


### 2026-10-06 — ลดต้นทุนอ่านป้ายเป็น Haiku 4.5
- ตามคำสั่งผู้ใช้ ลดค่าเริ่มต้น OCR เป็น claude-haiku-4-5-20251001 ทั้ง API และ console
- จำกัด max_tokens 512 จาก 4000; ส่งกลับยี่ห้อ รุ่น ซีเรียล และ confidence ไม่ถอด raw_text ทั้งป้าย; ปิด thinking สำหรับ Haiku ไม่ส่ง effort ที่ Haiku ไม่รองรับ และลบ automatic fallback ไปโมเดลอื่น
- API build และ mocked Claude tests 4 ข้อผ่าน ยืนยัน model/token cap/no effort/no fallback/no raw_text; ยังไม่ได้ทดสอบ AI จริง
- Deploy staging 3df7321 สำเร็จ เปลี่ยน model ใน env และ console row เป็น Haiku โดยคง key/enabled เดิมและเพิ่ม version/audit; restart API/worker และ ready ผ่าน
- พบ key บันทึกแล้ว ทดสอบ Anthropic จริงหนึ่งครั้งด้วยป้ายสังเคราะห์ (ไม่ใช้ข้อมูลร้าน/ลูกค้า): TESTCO / MODEL-123 / SN-456 อ่านตรงครบ 3 ช่อง ใช้เวลา 4.127 วินาที; ยังไม่ได้ทดสอบป้ายถ่ายจริงบนมือถือ; ไม่ต้อง rebuild APK เพราะเปลี่ยนฝั่งเซิร์ฟเวอร์


### 2026-10-06 — แก้การส่งรูป/session และเพิ่ม AI settings
- ตรวจ staging พบรูป 5 รายการค้าง pending_upload และไม่มี OCR request: ยังไม่ถึงขั้นอ่านรูป; เปลี่ยนมือถืออ่านไฟล์ native เป็น ArrayBuffer ส่ง bytes ตรง แสดงรูปทันที/สถานะ upload/ข้อความเฉพาะสาเหตุ และ retry รูปเดิมด้วย request key เดิม; แยกข้อความเมื่อกุญแจหรือโมเดล AI มีปัญหาและลบข้อความล้มเหลวซ้ำ
- พบ staging OCR_PROVIDER=development และไม่มี Anthropic key: ยังไม่ได้อ่านด้วย AI จริง ผู้ใช้มีบัญชีแล้วและขอเพิ่มหน้าตั้งค่าเพื่อใส่เอง
- เพิ่ม /console > ตั้งค่าระบบ > อ่านป้ายเครื่องด้วย AI: key เข้ารหัส AES-GCM, ไม่คืน secret ไม่ใส่ audit, step-up และ settings.manage; migration 027; API/worker โหลดค่าที่บันทึกทันทีโดย worker อ่านได้เฉพาะ OCR settings
- เก็บ access/refresh แบบ atomic ใน SecureStore พร้อมอ่าน legacy; เครือข่ายเสียไม่ล้าง session เพิ่มตัวเลือก biometric ในบัญชี (ปิดเป็นค่าเริ่มต้น) ใช้เมื่อเปิดแอปใหม่ มีใช้รหัสผ่านแทน ไม่เก็บรหัสผ่าน
- ลบ Version/About ออกจาก UI ตามคำสั่งผู้ใช้; metadata บริษัทคงไว้; เตรียม Android 0.2.5 / Build 7
- ตรวจ typecheck ทุกส่วนและ Next build ผ่าน; mobile transport/session + Claude mocked + console settings 19 ผ่าน; worker SQL 11 ผ่านบน PGlite; PostgreSQL จริง 42 ข้อ: รอบแรก 40 ผ่าน/2 ล้มจาก fixture เก่า (ไม่กรอก phone และ SMS_PROVIDER จาก .env); แก้ fixture แล้วตรวจ console 9 ผ่านและ customer-scope ผ่านแยก; ยังไม่มี device test/AI จริง; staging deploy 1d77395 + migration 027 สำเร็จ, worker อ่านฟังก์ชันตั้งค่าได้, OCR_PROVIDER เปลี่ยนเป็น claude (ไม่มี key จะ 503), API ready/console HTTPS 200; APK 0.2.5 / Build 7 สำเร็จบน D:\kc (source 891f731), certificate ตรง EAS เดิม, package/version/บริษัท/biometric/API staging ผ่าน; ไฟล์ output/builds/apk/KooChang-0.2.5-build7.apk


### 2026-10-06 — ทดลอง local Android build สำเร็จ
- ดาวน์โหลด credentials Android เดิมจาก EAS ไว้ในไฟล์ ignored; ไม่สร้าง key ใหม่ ไม่เผย passwords
- รอบแรก main workspace ล้มเหลว Expo CMake/Ninja พร้อมคำเตือนพาธยาว; แก้ด้วย source snapshot b40b210 ใน D:\kc และ pnpm hoisted เฉพาะ scratch ใช้ lockfile เดิม
- รอบสอง BUILD SUCCESSFUL 21m43s / 291 tasks; Release APK output/builds/apk/KooChang-0.2.4-build6.apk 75,553,519 bytes
- ตรวจ apksigner ผ่าน certificate SHA256 ตรง key เดิม; package com.koochang.app / 0.2.4 / Build 6; API staging ใน bundle และ company ไทย/อังกฤษตรง source
- บันทึกขั้นตอนและ workaround ใน ANDROID_LOCAL_BUILD.md พร้อม release record output/builds/koochang-0.2.4-local-release.md; APK และความลับไม่ commit
- สถานะ: build ในเครื่องสำเร็จ ไม่ได้ติดตั้ง/รันบนมือถือหรือทดสอบ AI รูปจริง; ไม่ยกเลิก EAS build


### 2026-10-06 — ติดตั้ง Android toolchain บน D
- ผู้ใช้สั่งติดตั้งบน D; ดาวน์โหลด Temurin JDK 17 และ Android command-line tools ทางการ ตรวจ SHA-256 ก่อนแตกไฟล์
- ติดตั้ง SDK Platform 36 / Build Tools 36.0.0 / NDK 27.1.12297006 / CMake 3.30.5 / Platform Tools ใน D:\Android\Sdk พร้อม SDK licenses
- ตั้งค่า JAVA_HOME/ANDROID_HOME/ANDROID_SDK_ROOT/GRADLE_USER_HOME และ user PATH สำหรับ D โดยคง PATH เดิม; แคช Gradle D:\Android\gradle-cache
- ตรวจ doctor ผ่านทุกตัว java/javac/adb/cmake/clang ใช้งานได้จริง ไม่ลง emulator/Android Studio เพิ่ม
- สถานะ: เครื่องมือพร้อม; ยังไม่ได้ดึง keystore เดิม สร้าง native project หรือ build APK ในเครื่อง การติดตั้งนี้ไม่เปลี่ยนงาน EAS ที่รออยู่


### 2026-10-06 — ตรวจเครื่องสำหรับ Android local build
- ตรวจ Node/pnpm/Java/Android SDK และพื้นที่: Node 24/pnpm/Git/ADB/Build Tools 36 พร้อม; Java/Javac, SDK 36, NDK 27.1.12297006 และ SDK Manager ยังขาด
- มีโฟลเดอร์ Android Studio แต่ไม่พบ java.exe ที่ใช้ได้; SDK มี Android 35 อยู่ ไม่ใช่รุ่นที่ RN 0.86.3 ใช้
- เตรียม scripts/android-build-doctor.ps1, android-build-env.ps1 และ docs/ANDROID_LOCAL_BUILD.md พร้อมวิธี Expo prebuild/Gradle บน Windows ใช้ signing เดิมและแคช D; เพิ่ม ignore native/signing
- ผลตรวจ doctor แสดง NOT READY ตามจริง; ยังไม่ได้ติดตั้งเครื่องมือ ยอมรับ SDK licenses ดาวน์โหลด keystore หรือ build ในเครื่อง


### 2026-10-06 — ชื่อบริษัทและ APK 0.2.4
- ผู้ใช้ยืนยันบริษัท ไอ ที อีส มี จำกัด / IT IS ME Co., Ltd.; ใส่ expo.extra.company ให้ About แสดงตามภาษา
- เตรียม APK 0.2.4 / Build 6 รวมเลขรุ่นหน้าเปิด/ก่อน login และ About รวมการแก้ OCR จาก 0.2.3
- ใช้ EAS staging-apk และ signing เดิม อัปโหลดสำเร็จ Build ID e2f12506-0b9c-43cc-9457-dfd5d459566c; รอผลใน output/builds/koochang-0.2.4-release.md


### 2026-10-06 — เลขรุ่นก่อนเข้าแอปและเมนู About
- ทำอะไร: เพิ่ม VersionLabel ใช้ manifest แอปที่ติดตั้ง ไม่พิมพ์เลขรุ่นซ้ำในหน้าจอ; แสดงหน้าเปิด/ต้อนรับ/เข้าสู่ระบบ เพิ่ม About ก่อน login และเมนูบัญชีทุกบทบาท พร้อมรายละเอียดและช่องบริษัทจาก config
- ปัญหา: ผู้ใช้อัปเดตแล้วยังเห็นเหมือนเดิม ไม่มีเลขรุ่นให้ตรวจ
- ตรวจพบ: EAS 0.2.3 FINISHED แล้ว ลิงก์ APK บันทึกใน output/builds/koochang-0.2.3-release.md; ยังยืนยันรุ่นที่ผู้ใช้ติดตั้งไม่ได้
- สถานะ: เตรียม 0.2.4 / Android Build 6; shared build/mobile typecheck ผ่าน ยังไม่ build/deploy หรือ device test; ถามชื่อบริษัทและรอคำตอบ ไม่เดาชื่อ


### 2026-10-06 — เตรียม APK 0.2.3
- อัปเดต version 0.2.3 / Android versionCode 5 เพื่อรวมสถานะและผล OCR พร้อมตรวจซ้ำรูปเดิม
- ใช้ staging-apk และ signing เดิม; ไม่มี API/schema เปลี่ยนในรอบนี้
- สถานะ: เตรียมส่ง EAS ตามคำสั่งผู้ใช้ ผล build บันทึกเมื่อเสร็จ


### 2026-10-06 — แสดงผลและสถานะ OCR หลังแนบรูป
- ทำอะไร: ส่งรูปป้ายอ่านอัตโนมัติหลังอัปโหลด แสดงกำลังส่ง/อ่าน/สำเร็จ/อ่านไม่ได้/บริการไม่พร้อม พร้อมค่าที่อ่านได้รายช่องและตรวจซ้ำ
- ปัญหาและสาเหตุ: catch เริ่ม OCR รีเซ็ตเป็น none จึงเงียบ; polling เดิมตัดที่ 30 วินาทีและคำขอซ้อนกัน
- แก้ไข: แสดงข้อผิดพลาด รอได้ 3 นาทีแล้วแสดงรอผลพร้อมตรวจซ้ำ; polling ต่อเนื่องทีละคำขอและยกเลิกผลเก่าเมื่อเปลี่ยนรูป; retry เครือข่ายใช้ request key เดิม
- สถานะ: shared build/mobile typecheck ผ่าน ยังไม่ได้ build APK/deploy หรือทดสอบกล้องและ OCR จริง


### 2026-10-06 — APK 0.2.2 build สำเร็จและพร้อมติดตั้ง

- EAS build `3ae38c64-e9ad-4f2c-803f-ab65244fa199` สำเร็จ 19:05 น. เวลาไทย; version 0.2.2 / versionCode 4, profile staging-apk, package com.koochang.app และ signing เดิม
- APK: https://expo.dev/artifacts/eas/s6dR3QL1B5sZKuO42VYFkSO-ePOz9WBsFZa0Ac-UH7E.apk
- รวมดอกจันสีแดง เบอร์โทรบังคับ ชื่อไม่บังคับ และ GPS ในหน้าเพิ่มลูกค้า; staging API/เว็บอัปเดตพร้อมแล้ว (1e240fcf) readiness และ owner web ผ่าน
- เก็บข้อมูลรุ่นและลิงก์ใน `output/builds/koochang-0.2.2-release.md`; อัปเดตทับรุ่นเดิมได้ ยังไม่ได้ติดตั้ง APK หรืออ่าน GPS บนอุปกรณ์จริงในรอบนี้


### 2026-10-06 — เริ่ม EAS build APK 0.2.2 หลังผู้ใช้อนุญาต

- ผู้ใช้ตอบ "ทำเลย" หลังคำถามอนุญาตส่งซอร์สไป Expo/EAS จึงเริ่ม profile staging-apk Android ด้วย signing เดิม (freeze credentials)
- อัปโหลด 297 MB สำเร็จ; build id `3ae38c64-e9ad-4f2c-803f-ab65244fa199`, version 0.2.2 / versionCode 4, commit source e20495357d5d41216a89773e2b3a55f5f4f1becc, API https://api-staging.koochang.com
- สถานะเริ่มต้น NEW; กำลังติดตามจนได้ผล ยังไม่มี APK ในเวลาที่เขียนรายการนี้; การบล็อก approval review รอบก่อนคลี่คลายด้วย authorization ผู้ใช้แล้ว


### 2026-10-06 — อัปเดต staging และเตรียม APK 0.2.2 (ยังไม่เริ่ม EAS build)

- ผู้ใช้สั่งอัปเดตแอปและ build; เตรียม version 0.2.2 / Android versionCode 4 และข้อความสิทธิ์ตำแหน่งให้ตรงกับปุ่มใช้ตำแหน่งปัจจุบัน (commit 1e240fcf)
- Staging uht-dev: ตรวจ working tree สะอาด, ส่ง incremental bundle จาก fa3b5828, fast-forward เป็น 1e240fcf, build shared/API/เว็บผ่าน และ restart เฉพาะ fs-staging-api/fs-staging-web ไม่มี migration ใหม่และไม่แตะ production
- ตรวจหลังอัปเดต: localhost readiness และ HTTPS https://api-staging.koochang.com/v1/ready ได้ ready; https://app-staging.koochang.com/shop HTTP 200
- APK: รุ่นก่อน 0.2.1 (versionCode 3) build 6c4f6fb4-d731-453b-b675-bcc7d1bec69d สำเร็จแล้ว; 0.2.2 ยังไม่มี build id หรือไฟล์ APK
- ปัญหา: automatic approval review ปฏิเสธคำสั่งเริ่ม EAS build เนื่องจากอัปโหลดซอร์สไปปลายทางภายนอกและต้องการ authorization Expo/EAS โดยตรง จึงถามผู้ใช้แล้ว รอคำตอบ ไม่ใช้คำสั่งอื่นเลี่ยงการปฏิเสธ
- ทำต่อ: เมื่อผู้ใช้อนุญาต Expo/EAS ให้รัน profile staging-apk Android 0.2.2 signing เดิม แล้วติดตามจนสำเร็จและส่ง URL APK


### 2026-10-06 — แก้กฎเพิ่มลูกค้า: เบอร์โทรบังคับ ชื่อไม่บังคับ

- ผู้ใช้ยืนยัน: ต้องกรอกเบอร์โทรเสมอ ชื่อลูกค้าเว้นว่างได้
- แก้หน้าเพิ่มลูกค้ามือถือ: ดอกจันเบอร์โทรแสดงเสมอ ไม่แสดงที่ชื่อ และแจ้งข้อความไทย/อังกฤษตรงกับกฎใหม่
- API create ตรวจ phone บังคับแม้มี name; เว็บร้านหน้าเพิ่มลูกค้าก็ใส่ required และปิดปุ่มบันทึกเมื่อไม่มีเบอร์ เพื่อให้ตรงกับ API ไม่เปลี่ยนข้อมูลลูกค้าเก่าหรือกฎแก้ไขย้อนหลัง
- ตรวจ: build packages, mobile typecheck, API build ผ่าน; ชุดลูกค้า PGlite 4 ผ่าน/0 ข้าม/0 ล้มเหลว เพิ่มกรณีชื่อว่างแต่มีเบอร์ผ่าน และมีชื่อแต่ไม่มีเบอร์/เบอร์ว่าง/ช่องว่างถูกปฏิเสธ; web typecheck ผ่าน
- สถานะ: บันทึกโค้ดแล้ว ยังไม่ได้ deploy หรือออก APK ใหม่

### 2026-10-06 — หน้าเพิ่มลูกค้า: ดอกจันสีแดงและใช้ตำแหน่งปัจจุบัน

- ทำอะไร: จากภาพหน้าจอผู้ใช้ เพิ่ม prop required ให้ Field แสดง `*` สีแดงและ accessibility label; หน้าเพิ่มลูกค้าแสดงเงื่อนไขชื่อหรือเบอร์อย่างน้อยหนึ่งอย่าง ชื่อสถานที่จำเป็น ส่วนที่อยู่/พิกัดไม่บังคับ; เพิ่มดอกจันชื่อสถานที่ในหน้าเพิ่ม/แก้สถานที่ด้วย
- ตำแหน่ง: ปุ่มใช้ตำแหน่งปัจจุบันอยู่ใต้ที่อยู่ ขอ foreground permission และอ่าน GPS ครั้งเดียวเมื่อกด แสดง latitude/longitude/accuracy แจ้งความแม่นยำต่ำและลบพิกัดได้ ก่อนกดบันทึกยังไม่เขียนข้อมูล; ไม่ให้สิทธิ์/อ่านไม่ได้ยังบันทึกแบบไม่มีพิกัดได้ และกันบันทึกขณะกำลังอ่าน GPS
- API: รับ location.coordinates ในคำขอเพิ่มลูกค้า/เพิ่มสถานที่ ตรวจช่วงตัวเลข/วิธีเก็บ/accuracy บันทึกคู่กับข้อมูลสถานที่ใน transaction เดียวพร้อมผู้บันทึก เวลา และ audit ไม่สร้างข้อมูลซ้ำหรือย้ายพิกัดเมื่อส่ง request key เดิมซ้ำ; ไม่มี migration ใหม่
- ตรวจ: build shared packages, typecheck มือถือ/API และ API build ผ่าน; `node --test tests/customers.test.mjs` บน PGlite 4 ผ่าน/0 ข้าม/0 ล้มเหลว ครอบคลุม GPS-only address, metadata, retry, zero coordinate, invalid payload, rollback และ RLS เดิม; diff check ผ่าน
- สถานะ/งานถัดไป: โค้ดพร้อม ยังไม่ได้ใช้ GPS จริงบนอุปกรณ์ ไม่ได้ deploy หรือออก APK ใหม่จากการเปลี่ยนแปลงนี้ ต้องอัปเดต API พร้อมแอปก่อนใช้การบันทึกพิกัดในหน้าเพิ่มลูกค้า


### 2026-10-06 — เปิดงานใหม่: ค้นหาเบอร์ไม่เจอแล้วไปต่อไม่ได้ → เพิ่มลูกค้าใหม่จากหน้าเลือกลูกค้า
- **ปัญหา** (ผู้ใช้ทดสอบบนมือถือ): กด "เปิดงานใหม่" → พิมพ์เบอร์ลูกค้าที่ยังไม่มีในระบบ หน้า "เลือกลูกค้า" ว่างเปล่า ไม่มีข้อความและไม่มีปุ่มให้ทำต่อ ต้องย้อนออกไปแท็บลูกค้าเพื่อเพิ่มก่อน
- **สาเหตุ**: `JobCustomerPicker` (ใช้ทั้งเปิดงานใหม่และบันทึกบริการนอกแผน) แสดงแค่รายการผลค้นหา ไม่มีสถานะ "ไม่พบ" และไม่มีทางไปฟอร์มเพิ่มลูกค้า
- **แก้**: เพิ่มปุ่ม "เพิ่มลูกค้า" ที่หัวหน้า และเมื่อไม่พบผลจะแสดง "ไม่พบลูกค้าที่ค้นหา" พร้อมปุ่มเพิ่มลูกค้า โดยนำเบอร์/ชื่อที่ค้นหาไปกรอกให้ในฟอร์ม; บันทึกแล้วไปต่อที่ฟอร์มเปิดงาน (หรือบันทึกบริการนอกแผน) ด้วยสถานที่แรกทันที ถ้าเลือกลูกค้าเดิมจากคำเตือนเบอร์ซ้ำ จะไปต่อเมื่อมีสถานที่เดียว ไม่เช่นนั้นเปิดหน้าลูกค้าให้เลือกสถานที่; ปุ่มย้อนกลับในฟอร์มกลับไปหน้าเลือกลูกค้าเดิม และกันผลค้นหาเก่าทับผลใหม่ (sequence)
- **สถานะ**: typecheck แอปมือถือผ่าน; staging อัปเดตโค้ดถึง fa3b582 (เปลี่ยนเฉพาะแอปมือถือ ไม่มี migration ใหม่ API/เว็บไม่ต้อง build ใหม่, health ok); สั่ง build APK 0.2.1 (versionCode 3) บน EAS แล้ว build id 6c4f6fb4 รอคิว; ยังไม่ได้ทดสอบบนมือถือจริง

### 2026-10-06 — สาเหตุที่ OTP ไม่ขึ้นใน log staging + THSMS ส่งไม่ถึงมือถือ

- **ปัญหา 1**: ช่วงที่ staging ยังเป็น `SMS_PROVIDER=development` ผู้ใช้กดขอ OTP แต่ไม่มีรหัสใน log; ตอนนั้นสรุปผิดว่า "คำขอไม่ถึงเซิร์ฟเวอร์"
- **สาเหตุ**: ใน console ของ staging มีค่า SMS ที่บันทึกไว้ (DeeSMSx เปิดใช้งาน, sender "ddd" ค่าทดลอง) ซึ่งตามการออกแบบเดิม "ค่าใน console ชนะ env" คำขอจึงไปที่ DeeSMSx ด้วย key ทดลอง ล้มเหลวและตอบ 503 ไม่เคยใช้ development sender
- **แก้อย่างไร**: นอก production ถ้า env ตั้ง `SMS_PROVIDER=development` (หรือ `thsms`) ให้ใช้ค่า env ก่อนค่าใน console; production ยังใช้ค่าใน console ตามเดิม เพิ่มทดสอบใน console-settings.test.mjs; ค่า DeeSMSx ใน console ไม่ได้ลบ (ผู้ใช้จะแก้/ปิดเองใน console)
- **ปัญหา 2**: THSMS รับคำขอ (มีในประวัติการส่ง ข้อความถูกต้อง) แต่สถานะปลายทาง "ส่งไม่สำเร็จ" และคืนเครดิต ทั้งจากแอปและจากการส่งทดสอบในเว็บ THSMS ชื่อผู้ส่ง "Direct SMS" ไปเบอร์ 0927946969
- **สาเหตุ (คาด)**: ชื่อผู้ส่งไม่ผ่านค่ายมือถือ หรือเบอร์บล็อก SMS โฆษณา (*137) ฝั่งโค้ดเรียก API ถูกต้องแล้ว
- **สถานะ**: รอผู้ใช้ตรวจชื่อผู้ส่ง/ลองเบอร์อื่น/ถาม THSMS; ทดสอบแอปต่อได้โดยสลับ `SMS_PROVIDER=development` แล้ว restart (ตอนนี้ได้ผลจริงแล้ว)

### 2026-10-06 — ส่ง OTP ผ่าน THSMS ชั่วคราวระหว่างทดสอบ

- **ทำอะไร**: ผู้ใช้ขอให้ใช้ THSMS (thsms.com API V2) ส่ง SMS ระหว่างทดสอบ จึงเพิ่ม `ThsmsSender` (POST https://thsms.com/api/send-sms, Bearer token, body { sender, msisdn: ['09xxxxxxxx'], message }, ถือว่าสำเร็จเมื่อได้ success: true) เลือกด้วย `SMS_PROVIDER=thsms` + `THSMS_TOKEN` + `THSMS_SENDER` (ชื่อผู้ส่งต้องตรงตัวพิมพ์กับที่ THSMS อนุมัติ) ค่านี้ใน env ชนะค่า SMS ที่ตั้งใน console เพื่อสลับกลับได้ง่าย; DeeSMSx ยังอยู่ครบ deploy โค้ด 10f606e ขึ้น staging แล้ว
- **ปัญหา**: หน้า thsms.com/sms-api ไม่แสดงรายละเอียด API (ตัวอย่างอยู่ใน GitHub gist) และระบบอนุญาตอัตโนมัติบล็อกการอ่าน gist ครั้งแรก
- **แก้อย่างไร**: ผู้ใช้ยืนยันให้ศึกษาหน้านั้น จึงอ่าน gist ของ THSMS และผู้ใช้ส่งภาพเอกสาร Send SMS (มีตัวอย่าง response) มายืนยัน
- **ปัญหาระหว่างตรวจ**: รันทดสอบรอบแรก tunnel SSH หลุดกลางทาง ทำให้ค้างและล้มหลายข้อ → เปิด tunnel ใหม่ (ServerAliveInterval) รันใหม่ผ่าน 192/192
- **สถานะ**: โค้ดพร้อม ทดสอบผ่าน; ต้องให้ผู้ใช้ใส่ THSMS_TOKEN/THSMS_SENDER และ SMS_PROVIDER=thsms ใน /etc/field-service/staging.env เอง (ห้ามส่ง token ในแชท) แล้ว restart fs-staging-api

### 2026-10-06 — เปลี่ยนการเข้าสู่ระบบเป็นเบอร์มือถือ + รหัสผ่าน (OTP เฉพาะตอนสมัคร/ลืมรหัส)

- **ทำอะไร**: ผู้ใช้แจ้งว่าการขอ OTP ทุกครั้งที่ login เปลืองค่า SMS จึงเปลี่ยนเป็น: สมัคร → OTP → ตั้งรหัสผ่าน → ครั้งต่อไปเข้าด้วยเบอร์ + รหัสผ่าน
  - DB: migration `026_phone_password.sql` ตาราง `auth.user_passwords` (เก็บ scrypt hash, fs_api อ่านตรงไม่ได้), `auth.password_attempts`, คอลัมน์ `auth.sessions.auth_method` และฟังก์ชัน `password_login_begin/finish`, `password_status`, `set_password`
  - API: `POST /v1/auth/password/login` (phone, password), `POST /v1/auth/password` (ตั้ง/เปลี่ยนรหัส), `/auth/otp/verify` และ `GET /me` ส่ง `password_set` เพิ่ม; error ใหม่ `PHONE_LOGIN_FAILED`, `LOGIN_LOCKED`, `PASSWORD_CHANGE_NOT_ALLOWED`
  - เว็บร้าน: หน้าเข้าสู่ระบบเป็นเบอร์ + รหัสผ่าน มีปุ่ม "ลืมรหัสผ่าน?" (OTP → ตั้งรหัสใหม่) สร้างร้าน = ชื่อร้าน + เบอร์ → OTP → ตั้งรหัส → สร้างร้าน; หน้าบัญชีมีฟอร์มเปลี่ยนรหัสผ่าน
  - แอปมือถือ: หน้าเข้าสู่ระบบใหม่ (เบอร์ + รหัสผ่าน + ลืมรหัสผ่าน), สร้างร้าน/เข้าร่วมร้านมี 3 ขั้น (ข้อมูล → OTP → ตั้งรหัส), หน้าลิงก์เข้าร่วมร้านมี "มีบัญชีอยู่แล้ว? เข้าสู่ระบบ" (ไม่ต้องใช้ SMS), หน้าบัญชีมี "เปลี่ยนรหัสผ่าน"
  - ความปลอดภัย: ผิด 5 ครั้งติดล็อก 15 นาที (จองครั้งก่อนตรวจ จึงเดาพร้อมกันหลายทางไม่ผ่าน), 60 ครั้ง/ชม. ต่อ IP, ตอบเหมือนกันเมื่อไม่มีเบอร์/ยังไม่ตั้งรหัส/รหัสผิด, เปลี่ยนรหัสแล้วเครื่องอื่นออกจากระบบ, ลืมรหัส = OTP ใหม่ภายใน 15 นาทีตั้งรหัสได้โดยไม่ต้องใช้รหัสเดิม
- **ปัญหา**: DECISIONS_A02 ข้อ 1 เดิมกำหนด "OTP ทุกครั้ง ไม่มีรหัสผ่าน"
- **สาเหตุ**: เลือกตามสเปกเดิม (ไม่บังคับช่างตั้งรหัส) แต่ค่า SMS ทุกครั้งที่ login สูงเกินไปสำหรับร้านเล็ก
- **แก้อย่างไร**: เปลี่ยนข้อ 1 อย่างเป็นทางการตามคำขอผู้ใช้ และเพิ่มข้อการออกแบบรหัสผ่านใน DECISIONS_A02; ไม่แก้ migration เก่า เพิ่ม 026 ใหม่
- **ปัญหาระหว่างตรวจ**: เปิด preview เว็บ (3001/3002) ไม่ได้ เพราะพอร์ตและโควตา dev server ถูก session อื่นใช้อยู่ → ตรวจด้วย typecheck + HTTP tests แทน ยังไม่ได้กดทดสอบหน้าจอจริง
- **สถานะ**: ทดสอบทั้งหมดบน PostgreSQL 16 ผ่าน 190/190 (เพิ่มทดสอบ DB 5 ข้อ + HTTP 1 ข้อครอบคลุม ตั้งรหัส/login/ล็อก/ลืมรหัส/เปลี่ยนรหัส/ไม่ส่ง SMS ตอน login); typecheck API/เว็บ/มือถือผ่าน; ฐาน dev migrate ถึง 026 แล้ว; **ยังไม่ deploy staging, ยังไม่ build APK ใหม่, ยังไม่ทดสอบบนมือถือจริง**
- **APK ใหม่ (ต่อจากรอบนี้)**: เพิ่มเวอร์ชันแอปเป็น 0.2.0 (versionCode 2) แล้วสั่ง EAS build โปรไฟล์ staging-apk ที่ https://expo.dev/accounts/bamrungsak_pj/projects/koochang/builds/73391277-6927-4a25-ac13-ed2d897d7dcd (ยังอยู่ในคิว) **ปัญหา**: APK นี้เรียก api-staging แต่ staging ยังไม่มี migration 026 จึงยังเข้าระบบด้วยรหัสผ่านไม่ได้ **สาเหตุ**: ระบบอนุญาตอัตโนมัติไม่ยอมให้คัดลอกโค้ด (git bundle) ไป server2 เมื่อผู้ใช้ไม่ได้สั่ง deploy ชัดเจน **แก้อย่างไร**: รอผู้ใช้ยืนยันให้ deploy staging (ขั้นตอนใน DEPLOY_SERVER2.md)
- **Deploy staging (ผู้ใช้สั่ง)**: ส่งโค้ด c1b944e ไป server2 → pnpm install/build (NEXT_PUBLIC_API_URL=https://api-staging.koochang.com) → migrate 026 → pm2 restart; ตรวจจากภายนอกผ่าน HTTPS แล้ว: `POST /v1/auth/password/login` ตอบ PHONE_LOGIN_FAILED สำหรับเบอร์ที่ไม่มี และ /shop ตอบ 200 → staging พร้อมใช้กับ APK 0.2.0 (build ยังทำงานอยู่)

### 2026-10-05 — เปลี่ยนสีธีมทั้งระบบเป็น navy + amber ให้เข้ากับโลโก้

- ผู้ใช้สั่ง: เปลี่ยนสีให้เข้ากันก่อน แล้ว build APK (ยกเลิก build b6bc9e8f ที่เริ่มไปแล้วเพื่อไม่เปลืองโควตา)
- เว็บ (console + เว็บร้าน + หน้าเข้าร่วมร้าน): ตัวแปรสีหลัก `--c-primary` #12243A (hover #0B1828), พื้นอ่อน #EDF1F6, เพิ่ม `--c-accent` #F5A623; focus ring และขอบช่องกรอกเป็น amber; ไอคอนเมนูที่เลือกเป็น amber; พื้นหลังหน้าเข้าสู่ระบบเป็นโทน navy/amber อ่อน; หน้าเข้าร่วมร้านจากโทนเขียว (teal) เดิมเป็น navy/amber
- มือถือ: `colors.primary` #12243A, pressed #0B1828, primarySoft #EDF1F6, เพิ่ม accent #F5A623; แถบเมนูล่างมีขีด amber เหนือแท็บที่เลือก; การ์ดร้านหน้าแรกพื้น navy ชื่อร้านสี amber
- หลักการ: amber ใช้เป็นสีเน้นเท่านั้น ไม่ใช้เป็นตัวหนังสือบนพื้นขาวเพราะคอนทราสต์ต่ำ
- ตรวจแล้ว: typecheck ทุก workspace; owner-web test; เปิด /console และ /shop บน dev server (พอร์ต 3002) ค่าสีที่คำนวณได้ตรง (ปุ่ม/brand mark rgb(18,36,58), accent #f5a623)
- deploy เว็บขึ้น staging (b2f1d15) ตรวจ CSS จริงมี `--c-primary:#12243a` / `--c-accent:#f5a623`; APK build 68d5b2b9 สำเร็จ (2026-10-06 01:36) รวมไอคอน, splash, หน้าเริ่มแอป และสีใหม่

### 2026-10-05 — ใช้อัตลักษณ์ที่เลือก: โลโก้ K + ประแจ (navy #12243A / amber #F5A623)

- ผู้ใช้ออกแบบและเลือกชุด `output/branding/koochang-selected` (โลโก้แนวนอน, ไอคอนแอป, ภาพเปิดแอป) → คัดลอกต้นฉบับไว้ใน `branding/koochang/` (อยู่ใน git)
- ทำอะไร: เขียน `scripts/make-app-icons.mjs` ใหม่ให้สร้างทุกไฟล์จากต้นฉบับ
  - ต้นฉบับเป็นภาพ raster ที่สี navy แกว่ง (#0e243f–#0f2642) จึงตัดพื้นหลังด้วย soft colour key แล้ววางบน navy เดียว #12243A ขอบไม่แตก
  - มือถือ: icon 1024 (พื้น navy เต็ม), adaptive icon (พื้นสี #12243A + สัญลักษณ์ในวงปลอดภัย), monochrome สำหรับ themed icon, splash ระบบ (สัญลักษณ์บน navy), หน้าเริ่มแอปใน JS แสดงสัญลักษณ์ + KooChang + คู่ช่าง บน navy อย่างน้อย 1.2 วินาที (ภาพเปิดแอปของผู้ออกแบบนำมาจัดแบบ responsive ไม่ยืดทั้งภาพ เพราะ Android 12+ แสดงได้เฉพาะไอคอนกลางจอ); หน้าต้อนรับใช้สัญลักษณ์แทนไอคอนประแจ
  - เว็บ: favicon และ brand mark เริ่มต้นเป็นสัญลักษณ์ K (`public/icon-32/192/512.png`, `apple-touch-icon.png`) แทน `icon.svg` เดิม; โลโก้ที่อัปโหลดจาก console ยังทับได้เหมือนเดิม
- ยังไม่ทำ: เปลี่ยนสีธีมทั้งระบบจากน้ำเงินเป็น navy/amber (รอผู้ใช้ตัดสินใจ); ไฟล์ vector ต้นฉบับยังไม่มี (README ของผู้ออกแบบระบุว่าต้องมีก่อนขึ้น production)
- ตรวจแล้ว: ดูภาพตัวอย่างไอคอน/adaptive/lockup/monochrome; typecheck ทุก workspace, next build, expo export android ผ่าน; owner-web + branding tests ผ่าน
- สถานะ: ⏳ APK รอบหน้า (ผู้ใช้สั่งยังไม่ build)

### 2026-10-05 — ผู้ใช้เลือกโลโก้ KooChang แบบ B / สี 1 และจัดชุดไฟล์ที่เลือก

- การตัดสินใจ: ใช้สัญลักษณ์ K แบบ B ที่แขนบนเป็นประแจ กับสี 1 กรมท่า `#12243A` / ส้มอำพัน `#F5A623` / ขาวนวล `#F8FAFC`
- ทำอะไร: จัดชุดไฟล์แยก logo-horizontal.png พื้นโปร่งใส, app-icon.png พื้นกรมท่าเต็มสี่เหลี่ยม, splash-screen.png ภาพเปิดแอปแนวตั้ง พร้อม README ใน `output/branding/koochang-selected/`
- ตรวจ: ดูองค์ประกอบและการสะกด KooChang/คู่ช่างจากภาพ; เป็นภาพ PNG generated ค่าสีจริงอาจต่างจากค่าเป้าหมายและรูปทรงอาจต่างกันเล็กน้อย ต้องทำ master และขนาดแพลตฟอร์มก่อนใช้งานจริง
- สถานะ: ยืนยันแนวแบรนด์และจัดชุดภาพแล้ว ยังไม่ได้แทน asset เว็บไซต์/มือถือ ไม่ได้ทำ animation หรือ deploy


### 2026-10-05 — เลือกสัญลักษณ์ B และเทียบสีที่เด่นขึ้น (v4)

- ทำอะไร: ผู้ใช้ชอบสัญลักษณ์ B ของ v3 จึงเก็บรูปทรง K ที่แขนบนเป็นประแจ และสร้างภาพเทียบสี 1 กรมท่า/ส้มอำพัน, 2 เขียวเข้ม/เหลืองทอง, 3 ม่วงเข้ม/อควา พร้อมตัวอย่างพื้นไอคอนเข้ม ใน `output/branding/koochang-v4/`
- หลักการ: สีฐานเข้มกับสีเน้นสว่างต่างกันทั้งโทนและความสว่าง; เปลี่ยนเสาตัว K เป็นขาวเมื่อใช้พื้นไอคอนเข้ม คงหัวประแจเป็นสีเน้น ไม่อ้างว่าสีรับประกันความเชื่อใจหรือยอดขาย
- ตรวจแล้ว: ภาพใช้สัญลักษณ์ B ทั้งสามแนว; คำนวณ contrast ของคู่สีเป้าหมายได้ 7.74, 7.09, 7.49 ตามลำดับ (เป็นค่า hex ที่กำหนด ไม่ใช่การรับรองสีจริงในภาพ generated)
- สถานะ: แนะนำแนว 1 ให้เด่นและเหมาะกับงานบริการ; ยังไม่ได้เลือกสีสุดท้าย ส่งออก asset แยก เปลี่ยนแอป/เว็บ หรือ deploy


### 2026-10-05 — ปรับหัวประแจในสัญลักษณ์ K (แบบเทียบ v3)

- ทำอะไร: สร้างแบบเทียบ A ขยายช่องประแจกลาง K, B เปลี่ยนแขนบน K เป็นประแจเต็มรูป, C ตัว K เรียบไม่มีประแจ เก็บใน `output/branding/koochang-v3/`
- ปัญหา/สาเหตุ: ช่องประแจเดิมดูคล้ายส่วนโค้ง ยังอ่านเป็นประแจไม่ชัด; แบบ A ที่สร้างใหม่ยังมีปัญหาเดียวกันบางส่วน
- แก้อย่างไร: แบบ B ย้ายปากประแจไปปลายแขนบน ทำให้เห็นปากเปิดและด้ามชัด; แบบ C ให้ตัวเลือกที่ลดรายละเอียดสำหรับไอคอน ใช้สีเดียวกันเพื่อเทียบรูปทรงโดยไม่รบกวนด้วยสี
- สถานะ: ตรวจภาพแล้ว แนะนำ B หากต้องการเห็นประแจชัด ยังไม่ได้เลือกแบบสุดท้ายหรือแทนไฟล์เว็บ/แอป; ขนาดเล็กจริงและ geometry vector ยังต้องตรวจตอนเตรียมใช้งาน


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
