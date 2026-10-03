# สถาปัตยกรรมเทคโนโลยีและฐานโครงการระบบงานบริการภาคสนาม

ฉบับข้อความสกัดจาก DOCX เพื่อให้อ่านด้วยเครื่องมือเขียนโค้ดได้ ภาพและรูปแบบต้นฉบับให้เปิด DOCX และ prototypes ประกอบ

สถาปัตยกรรมเทคโนโลยี
และฐานโครงการระบบงานบริการภาคสนาม

Technical Architecture and Project Foundation • ฉบับ 1.0 • 3 ตุลาคม 2569

เลือกเทคโนโลยีและสร้างฐานโครงการสำหรับแอปมือถือ ร้าน ช่าง และเว็บผู้ดูแลแพลตฟอร์มแล้ว เอกสารนี้อธิบายโค้ดที่ส่งจริง วิธีเริ่มพัฒนา และขอบเขตที่ยังต้องทำก่อนเปิดใช้งานกับร้านจริง โดยใช้ชื่อกลางที่เปลี่ยนชื่อผลิตภัณฑ์ภายหลังได้

## 1 ผลลัพธ์และขอบเขต

• แอปมือถือ React Native + Expo เว็บหลังบ้าน Next.js และ API NestJS อยู่ในโครงการเดียวกัน

• ฐานข้อมูลเป้าหมาย PostgreSQL 16 บน Ubuntu 24.04 มี migration 41 ตาราง และข้อมูลจำลอง 2 ร้าน

• ภาษาไทย th และอังกฤษ en มีข้อความร่วม การเปลี่ยนภาษา และรูปแบบวันที่/เงิน

• มีการตรวจชนิดข้อมูล สร้างโปรแกรม และทดสอบอัตโนมัติ 25 ข้อผ่านทั้งหมด

• ฐานนี้ยังไม่มีการเข้าสู่ระบบจริง งานบริการครบวงจร รับเงิน SMS หรือ OCR จึงยังไม่พร้อมเปิดขาย

### หลักการที่คงไว้

Capture Once Reuse Forever: เก็บลูกค้า สถานที่ อุปกรณ์ และประวัติเพื่อใช้ซ้ำ • Technician First และ Camera First • AI must never block workflow • Installation และ QR equipment sticker เป็นทางเลือก • Don’t Become ERP

GPS เก็บเฉพาะพิกัดสถานที่ลูกค้าเมื่อผู้ใช้กดบันทึก ไม่มีการติดตามช่าง ไม่มี background/start/end GPS และไม่เพิ่มสิทธิ์ตำแหน่งในแอปฐานโดยยังไม่มีหน้าที่ใช้งานจริง

### หัวข้อในเอกสาร

2 เทคโนโลยี • 3 โครงสร้างโครงการ • 4 ฐานข้อมูล • 5 สิทธิ์และความปลอดภัย • 6 ภาษาและหน้าจอ • 7 เริ่มพัฒนา • 8 Ubuntu และ migration • 9 ผลตรวจสอบ • 10 งานถัดไปและเอกสารอ้างอิง

## 2 เทคโนโลยีที่เลือก

| ส่วน | รุ่นที่ล็อก | หน้าที่ |
| --- | --- | --- |
| Mobile | Expo 57.0.26 / React Native 0.86.3 | แอป Android และ iOS |
| UI runtime | React 19.2.3 | ใช้รุ่นที่สอดคล้องกับ Expo |
| Platform web | Next.js 16.3.8 | เว็บหลังบ้านและหน้าจอผู้ดูแล |
| Backend | NestJS 12.1.2 / ESM | REST API และกติกาธุรกิจ |
| Database target | PostgreSQL 16 | ข้อมูลร้าน งาน ประวัติ และสมาชิก |
| Runtime | Node.js 24.19.0 | Node 24 LTS |
| Package manager | pnpm 11.25.0 | Workspace และ lockfile |
| Language / driver | TypeScript 6.0.3 / pg 8.23.1 | ตรวจชนิดข้อมูลและเชื่อม PostgreSQL |

เลือก TypeScript 6 ที่ตรวจความเข้ากันได้ในโครงการแล้ว ไม่อัปเกรดเพียงเพราะมีรุ่นใหม่กว่า ใช้ pnpm-lock.yaml และ --frozen-lockfile เพื่อทำซ้ำชุด dependency เดิม ปรับรุ่นผ่านงานแยกพร้อมตรวจทุกแอป

### เหตุผลของโครงสร้าง

ใช้ TypeScript ร่วมกันเพื่อลดความต่างของสถานะ รหัสข้อผิดพลาด และคำแปล Mobile เน้นงานหน้างาน ส่วน Next.js เหมาะกับหลังบ้านที่มีตารางและการบริหารร้าน NestJS แยกโมดูลธุรกิจใน API เดียวเพื่อเริ่มง่ายก่อนเพิ่มบริการเมื่อมีความจำเป็น

ใช้ SQL migration โดยตรงในฐานนี้เพื่อให้ ownership, composite foreign key, partial index และ RLS ตรวจสอบได้ชัดเจน PostgreSQL เป็นฐานข้อมูลหลัก ไม่เพิ่ม MySQL หรือ SQL Server อีกชุด

## 3 โครงสร้างโครงการและการเชื่อมต่อ

| ตำแหน่ง | สิ่งที่มีแล้ว |
| --- | --- |
| apps/mobile | Expo app ฐาน เลือกภาษาและจำบนอุปกรณ์ |
| apps/admin | Next.js dashboard ฐาน ปุ่มตรวจ API และภาษา |
| apps/api | Health/readiness ข้อผิดพลาดสองภาษา และ tenant transaction |
| packages/core | สถานะ บทบาท ประเภทงาน และภาษา |
| packages/i18n | ข้อความร่วม วันที่ ปฏิทิน และจำนวนเงิน |
| database/migrations / seeds | SQL schema และข้อมูลจำลอง |
| infra / scripts | PostgreSQL สำหรับ local และ migration runner |
| tests / .github/workflows | ทดสอบฐานข้อมูล ภาษา API และ CI ที่เตรียมไว้ |
| docs | สถาปัตยกรรม รายการตาราง และผลตรวจสอบ |

### การไหลของข้อมูลที่ตั้งใจใช้

Mobile / Platform Web → REST API /v1 → ยืนยัน session → ตรวจสิทธิ์ร้านและคำสั่ง → tenant transaction → PostgreSQL ส่วนไฟล์ภาพจะใช้ private object storage พร้อม signed URL เมื่อพัฒนาการอัปโหลดจริง

ปัจจุบันเปิดเฉพาะ endpoint ตรวจสถานะและ capabilities ส่วน business endpoint ปิดด้วย guard ที่ตอบ 401 ไม่รับ header ที่ผู้เรียกกำหนดเองเป็นตัวตนหรือสิทธิ์ร้าน

Platform Admin จะใช้การยืนยันตัวตนและช่องทางข้อมูลที่แยกจากร้าน ไม่ใช้ fs_api อ่านข้อมูลผู้ดูแล ไม่เปิดหน้าจอฐานนี้บนอินเทอร์เน็ตเป็นหลังบ้านจริง

## 4 โครงสร้างฐานข้อมูลที่สร้างแล้ว

| Schema | จำนวน | ขอบเขต |
| --- | --- | --- |
| core | 20 | ผู้ใช้ ร้าน ทีม ลูกค้า สถานที่ อุปกรณ์ งาน ประวัติ และรอบดูแล |
| billing | 12 | แพ็กเกจ สมาชิก รอบราคา ใบแจ้งชำระ เงิน และโควตา |
| platform | 6 | บัญชีผู้ดูแล บทบาท ช่วยเหลือ และคำขอข้อมูล |
| ops | 3 | งานปฏิบัติการและบันทึกตรวจสอบ |

### ความสัมพันธ์หลัก

Organization → Customer → Customer Location → Equipment; Job เป็นแผนงาน มีรายการอุปกรณ์และการมอบหมาย ส่วน ServiceEvent เป็นผลการทำงานจริง มี service_event_equipment แยกรายเครื่อง ไม่ใช้ Job แทนประวัติบริการ

งานที่ committed แล้วมี ServiceEvent หลักหนึ่งชุดต่อ Job พร้อมหลายรายการอุปกรณ์ การส่งซ้ำใช้ client identifier และ unique constraint เพื่อไม่สร้างประวัติซ้ำ Maintenance Schedule และ Cycle เป็นฐานของการแจ้ง Owner แล้วสร้างงานใหม่มอบหมายช่างคนอื่นได้

### กติกาที่ฐานข้อมูลรองรับ

• Foreign key ประกอบด้วย organization_id เพื่อลดการเชื่อมข้อมูลข้ามร้าน และตรวจความสัมพันธ์ลูกค้า/สถานที่/อุปกรณ์

• มี partial unique index สำหรับ Owner หลัก Join Link ที่ใช้ได้ การมอบหมายที่ยังเปิด และ maintenance cycle ที่ยังเปิด

• พิกัดและข้อมูลการบันทึกอยู่ที่ customer_locations เท่านั้น ไม่อยู่ที่ผู้ใช้ งาน หรือ ServiceEvent

• เก็บจำนวนเงินเป็นหน่วยย่อยจำนวนเต็ม เก็บเวลาแบบมี timezone และมี version สำหรับรองรับ optimistic concurrency

• ราคาที่ออกเป็น plan version เปลี่ยนย้อนหลังไม่ได้ การคำนวณยอด การคืนเงิน และจองโควตาแบบ atomic ยังต้องทำในบริการธุรกิจ

## 5 การแบ่งสิทธิ์และความปลอดภัย

| Role ฐานข้อมูล | การใช้งาน |
| --- | --- |
| fs_owner | Bootstrap ฐาน local ไม่ใช้เชื่อม API |
| fs_migrator | สร้าง schema และ migration ไม่ใช้ใน runtime |
| fs_api | Runtime ร้าน ไม่มี superuser หรือ BYPASSRLS |

เปิดและ FORCE Row-Level Security สำหรับตารางร้าน Context ใช้ app.user_id และ app.organization_id แบบ transaction-local และตรวจผู้ใช้ สมาชิก และร้านว่ายัง active ก่อนอนุญาตเข้าถึงข้อมูล

### ขั้นตอน tenant transaction

• รับ user ID จาก session ที่ยืนยันจริงเท่านั้น แล้วตรวจ organization ที่ขอใช้งาน

• BEGIN และตรวจว่า connection ใช้ fs_api ที่ไม่ใช่ superuser/BYPASSRLS

• ตั้ง context เฉพาะ transaction ตรวจ tenant_allowed แล้วทำคำสั่ง

• COMMIT หรือ ROLLBACK และคืน connection การทดสอบยืนยันว่า context ไม่ติดไปคำขอถัดไป

ข้อมูลการเงินที่เปิดอ่านกับร้านกำหนด Owner เป็นหลัก ช่างอ่านข้อมูลการเงินดังกล่าวไม่ได้ fs_api ไม่มีสิทธิ์อ่าน schema platform บันทึก audit ไม่ให้แก้หรือ DELETE ผ่าน role ร้าน

### ชั้นที่ยังต้องพัฒนาก่อนใช้จริง

RLS ป้องกันข้ามร้าน แต่สิทธิ์ช่างดูเฉพาะงานที่ได้รับมอบหมายต้องตรวจเพิ่มใน API รวมถึงสถานะ subscription, seat limit, quota, version และสิทธิ์ต่อคำสั่ง ยังไม่มี verified session, OTP, refresh token หรือ platform login ในฐานนี้ จึงคง business API ปิดไว้

การเข้าช่วยเหลือร้านต้องมี consent และ approval ระยะจำกัด ขณะนี้มีโครงสร้างตาราง ยังไม่มีบริการอนุมัติหรือการเข้าถึงข้อมูลจริง

## 6 ภาษาและหน้าจอฐาน

กำหนดรหัสภาษา th และ en ทุกแอปใช้ catalog ร่วม รหัสข้อผิดพลาดคงเดิมเมื่อเปลี่ยนภาษา และไม่ส่ง translation key หรือข้อความฐานข้อมูลภายในให้ผู้ใช้

| รายการ | สถานะปัจจุบัน |
| --- | --- |
| เลือกภาษา | Mobile และ Admin เปลี่ยนภาษาและจำบนอุปกรณ์ |
| วันที่ | ไทยใช้ พ.ศ. อังกฤษใช้ ค.ศ. แสดง timezone ตามที่กำหนด |
| เงิน | THB เดิม การเปลี่ยนภาษาไม่เปลี่ยนสกุลเงิน |
| ข้อความผู้ใช้ | ชื่อ ที่อยู่ และบันทึกไม่แปลอัตโนมัติ |
| ภาษาในบัญชี | มีคอลัมน์ในฐานข้อมูล ยังไม่ sync เพราะยังไม่มี login |
| Notifications | มีฐานข้อมูล การส่งจริงและเลือกภาษาผู้รับเป็นงานถัดไป |

หน้าจอฐานใช้โทนครีม เขียวอมฟ้า และสีเน้นตามแนวทางที่ยอมรับแล้ว มีป้ายระบุว่ายังเป็นฐานโครงการ ปุ่มงาน ลูกค้า และสมาชิกที่ยังไม่มีบริการจริงไม่ควรถูกตีความว่า workflow เสร็จแล้ว

### เกณฑ์สำหรับหน้าจอเมื่อพัฒนาต่อ

• ช่าง: งานวันนี้ → โทร/นำทาง → เลือกอุปกรณ์ → ถ่ายภาพ/บันทึก → ปิดงาน

• ร้าน: งานและทีม → รอบดูแลที่ถึงกำหนด → สร้างงานใหม่ → เลือกช่างคนใดก็ได้ที่มีสิทธิ์

• การบันทึกตำแหน่งต้องเป็นการกดโดยผู้ใช้ ไม่ผูกกับเริ่มงานหรือจบงาน

• OCR ล้มเหลวต้องกรอกเองและบันทึกต่อได้ ไม่บังคับ Installation หรือสติกเกอร์ QR

• เว็บผู้ดูแล: ร้าน สมาชิก การชำระ สิทธิ์ช่วยเหลือ และ audit ต้องมี role แยกชัดเจน

## 7 วิธีเริ่มพัฒนาในเครื่อง

แตก ZIP แล้วเปิดโฟลเดอร์ field-service ใช้ Node.js และ pnpm ตามรุ่นที่ระบุ README มีคำสั่งที่คัดลอกได้ โครงการไม่รวม node_modules, รหัสผ่านจริง หรือไฟล์ build

• 1. รัน pnpm install --frozen-lockfile

• 2. คัดลอก .env.example เป็น .env: Windows ใช้ Copy-Item .env.example .env; Ubuntu ใช้ cp .env.example .env

• 3. ตั้งรหัสผ่านและ connection URL ให้ตรงกัน ไม่ใช้ค่าตัวอย่างเป็นรหัสผ่านจริง

• 4. สำหรับ local ที่มี Docker รัน docker compose --env-file .env -f infra/compose.yaml up -d

• 5. รัน pnpm db:migrate และ pnpm db:seed เฉพาะข้อมูลจำลองในเครื่อง

• 6. รัน pnpm build:packages จากนั้น pnpm dev:api; เปิด terminal เพิ่มรัน pnpm dev:admin และ pnpm dev:mobile

Mobile บนอุปกรณ์จริงต้องใช้ที่อยู่เครื่องพัฒนาที่โทรศัพท์เข้าถึงได้ localhost ของโทรศัพท์ไม่ใช่เครื่อง API การเปิดรับ LAN ให้ตั้ง HOST และเครือข่ายอย่างตั้งใจ ไม่ใช้ production credentials ในเครื่องพัฒนา

### จุดตรวจหลังเริ่ม

GET /v1/health ตรวจ process; GET /v1/ready ตรวจฐานข้อมูลและ runtime role; GET /v1/capabilities บอกขอบเขตปัจจุบัน Business endpoint ต้องตอบ 401 จนกว่าจะเพิ่ม session และ authorization จริง

### คำสั่งตรวจโครงการ

pnpm typecheck • pnpm test • pnpm build • pnpm mobile:check • pnpm mobile:export

db:seed จำกัด NODE_ENV=development และ connection loopback ห้ามเปลี่ยนข้อจำกัดเพื่อใส่ข้อมูลจำลองลงฐาน production ไม่มีไฟล์ .env จริงอยู่ใน ZIP

## 8 Ubuntu 24.04 และการเปลี่ยนฐานข้อมูล

กำหนดเป้าหมาย PostgreSQL 16 บน Ubuntu 24.04 ที่มีอยู่ Docker Compose ในชุดนี้เป็นตัวเลือก local เท่านั้น สามารถติดตั้ง PostgreSQL แบบ native บนเซิร์ฟเวอร์จริงได้ รอบนี้ยังไม่ได้เชื่อมต่อหรือติดตั้งบน Ubuntu ของผู้ใช้

### แนวทางเตรียมเซิร์ฟเวอร์

• แยกฐาน staging และ production พร้อม role migration/runtime และรหัสผ่านคนละชุด

• เตรียม role ตาม infra/init/00-roles.sql และให้ fs_migrator เป็นผู้สร้าง schema ส่วน fs_api ใช้งานผ่านสิทธิ์ที่ migration ให้

• จำกัด network database ให้เฉพาะ API และผู้ดูแลที่จำเป็น ใช้ช่องทางเข้ารหัสเมื่อเชื่อมข้ามเครื่อง

• ตั้ง secret นอก source code ตั้ง backup นอกเครื่องหลัก และทดสอบ restore ก่อนเปิดร้านจริง

• รัน migration และ test suite บน PostgreSQL 16 ก่อนอนุมัติ deploy พร้อมตรวจ role ว่าไม่มี BYPASSRLS

### กติกา migration

Runner ใช้ MIGRATION_DATABASE_URL และตรวจ current_user=fs_migrator มี advisory lock ป้องกันการรันชน บันทึก SHA-256 ของไฟล์ที่รันแล้ว และปฏิเสธไฟล์เดิมที่แก้เนื้อหา แต่ละ migration อยู่ใน transaction

เมื่อขึ้นระบบแล้วเพิ่ม migration ใหม่แทนแก้ไฟล์เดิม สำรองข้อมูลและตรวจ restore ก่อนเปลี่ยนที่มีผลต่อข้อมูลจริง ใช้ forward fix ที่ทดสอบแล้ว ไม่ถือว่าลบคอลัมน์ย้อนหลังจะคืนข้อมูลได้

แยก development/test/staging/production อย่างชัดเจน Native test ต้องใช้ฐานใหม่ที่ชื่อจบด้วย _test และ loopback ตาม guard ของชุดทดสอบ ไม่รันทดสอบทำลายข้อมูลบนฐานร้านจริง

## 9 ผลตรวจสอบที่รันจริง

| รายการ | ผลและขอบเขต |
| --- | --- |
| Typecheck | ผ่านทั้ง shared packages, API, Admin และ Mobile |
| Backend / Admin build | ผ่าน API compilation และ Next.js production build |
| Automated tests | 25 ข้อผ่าน: schema, RLS, tenant context, ภาษา และ HTTP guard |
| Database engine ที่ใช้ทดสอบ | PGlite ซึ่งใช้ PostgreSQL 18.3 ยังไม่ใช่เป้าหมาย 16 |
| Mobile SDK check | เทียบรุ่นกับ Expo SDK ที่ติดตั้ง แบบ offline ผ่าน |
| Android / iOS export | สร้าง JavaScript/Hermes bundles สำเร็จ ยังไม่ใช่ APK/IPA |
| Admin browser | ไทย/อังกฤษ จำภาษา reload และหน้าจอ 320 px ไม่ล้น |
| CI PostgreSQL 16 | เตรียม workflow แล้ว ยังไม่ได้รันบน GitHub |

### ตัวอย่างความเสี่ยงที่ชุดทดสอบป้องกัน

• เจ้าของร้าน A อ่านลูกค้าร้าน B ไม่ได้ แม้ปลอม tenant context

• ไม่มี tenant context ต้องไม่เห็นข้อมูล และ context ถูกล้างเมื่อจบ transaction

• membership/user/organization ถูก suspend ต้องถูกปฏิเสธ

• ช่างอ่านการเงินไม่ได้ และ role ร้านเข้าตาราง platform ไม่ได้

• เชื่อม foreign key ข้ามร้านหรือบันทึกพิกัดผิดช่วงต้องล้มเหลว

• ส่ง ServiceEvent ซ้ำไม่สร้างซ้ำ ราคา plan version แก้ย้อนหลังไม่ได้

• withTenant ปฏิเสธ superuser ก่อน callback และปล่อย connection

• ปลอม header/token ยังเปิด business API ไม่ได้ และเปลี่ยนภาษาไม่เปลี่ยน error code

ยังไม่ได้ทดสอบบนโทรศัพท์จริง สร้าง native binary ส่ง App Store/Play Store ตรวจโหลดจริง หรือเชื่อมเซิร์ฟเวอร์ Ubuntu ผลผ่านข้างต้นเป็นเกณฑ์ฐานโครงการ ไม่ใช่การรับรองว่าโปรแกรมธุรกิจครบแล้ว

## 10 งานถัดไปและการใช้เอกสาร

### ลำดับพัฒนาต่อจากฐานนี้

| ช่วง | ผลที่ต้องได้ |
| --- | --- |
| A02 Identity / Organization | Owner registration, OTP/session, Join Link/QR ใช้ซ้ำ, pending/approval, role และ shop context |
| B งานบริการ | ลูกค้า สถานที่ อุปกรณ์ งานหลายเครื่อง มอบหมาย ประวัติ ภาพ และ ad-hoc |
| B รอบดูแล | Maintenance due แจ้งร้าน สร้างงานใหม่และเปลี่ยนช่างได้ |
| C สมาชิก / Platform | Trial/renewal/grace, โควตา atomic, ตรวจชำระจริง, admin role และ audit |
| ก่อนทดลองร้านจริง | PostgreSQL 16, อุปกรณ์จริง, storage/SMS, restore, end-to-end และสิทธิ์ครบ |

การตัดสินใจเรื่องผู้ให้บริการ SMS, OCR/AI และ object storage ต้องทำก่อนเชื่อมบริการนั้น ไม่กระทบการเริ่มงานลูกค้า/งาน/ประวัติ การชำระเริ่มด้วยการโอนและตรวจยอดตาม commercial baseline ส่วน LINE OA เป็น future integration

### ความสัมพันธ์กับเอกสารเดิม

ใช้ร่วมกับ Product / Functional Specification, UI/UX Design, Database / Backend Design และ Commercial Policy MVP Baseline ฉบับ 1.1 เอกสารนี้อธิบาย implementation foundation ปัจจุบัน หากเอกสารเดิมอธิบายระบบครบ ให้แยกจากสถานะโค้ดที่มีแล้วในข้อ 9

### แหล่งอ้างอิงเทคโนโลยี

https://docs.expo.dev/versions/latest/

https://docs.expo.dev/guides/monorepos/

https://nextjs.org/docs/app/getting-started/installation

https://docs.nestjs.com/first-steps

https://www.postgresql.org/docs/16/ddl-rowsecurity.html

https://www.postgresql.org/download/linux/ubuntu/

อ้างอิงรุ่น dependency จาก manifest และ lockfile ที่ส่งในโครงการ ตรวจ ณ 3 ตุลาคม 2569 การอัปเกรดในอนาคตต้องตรวจ compatibility และผลทดสอบใหม่
