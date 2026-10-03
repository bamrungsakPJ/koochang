# เอกสารออกแบบฐานข้อมูลและระบบหลังบ้านสำหรับงานบริการภาคสนาม

ฉบับข้อความสกัดจาก DOCX เพื่อให้อ่านด้วยเครื่องมือเขียนโค้ดได้ ภาพและรูปแบบต้นฉบับให้เปิด DOCX และ prototypes ประกอบ

เอกสารออกแบบฐานข้อมูล
และระบบหลังบ้าน
สำหรับงานบริการภาคสนาม

Database and Backend Design Specification

PostgreSQL 16 บน Ubuntu 24.04 สำหรับ Mobile-first SaaS

ฉบับ 1.1  วันที่ 2 ตุลาคม 2569

เอกสารกลางสำหรับทีมพัฒนาและทดสอบ ยังไม่ผูกกับชื่อผลิตภัณฑ์สุดท้าย

### วัตถุประสงค์

กำหนดตาราง ความสัมพันธ์ สิทธิ์ และการทำงานของระบบหลังบ้านให้สอดคล้องกับ Product Functional Specification และเอกสาร UI UX ฉบับ 1.1 เพื่อให้ข้อมูลบริการของช่างคนหนึ่งนำไปใช้สร้างงานรอบใหม่และมอบหมายช่างอีกคนได้อย่างถูกต้อง

ฐานข้อมูลเก็บข้อมูลธุรกิจแบบสัมพันธ์ แอปติดต่อผ่าน API ระบบหลังบ้านเป็นผู้ตรวจสิทธิ์และบันทึกข้อมูล PostgreSQL ไม่เปิดให้แอปมือถือเชื่อมโดยตรง รูปภาพเก็บในพื้นที่ไฟล์ส่วนตัวและเก็บข้อมูลอ้างอิงในฐานข้อมูล

เอกสารนี้เป็นแบบออกแบบสำหรับพัฒนา ไม่ใช่ผลการติดตั้งหรือทดสอบระบบจริง รายละเอียดเชิงนโยบายที่เสนอใหม่แสดงในหัวข้อข้อเสนอเพื่อพัฒนา ส่วน DDL migration และ API schema แบบเครื่องอ่านได้เป็นงานต่อเนื่องตามหัวข้อส่งต่อ

### กติกาที่คงไว้

• เก็บ GPS เฉพาะสถานที่ลูกค้าเมื่อผู้ใช้กดบันทึก ไม่มีการติดตามช่างและไม่มี start end background GPS

• Installation และ QR sticker ประจำอุปกรณ์เป็น optional

• OCR และ AI ต้องไม่ขวางการสร้างอุปกรณ์หรือปิดงาน

• ข้อมูลลูกค้า สถานที่ อุปกรณ์ และประวัติต้องนำกลับมาใช้ได้ Capture Once Reuse Forever

• ระบบเน้นงานบริการ ไม่เพิ่มบัญชี สต็อก เงินเดือน หรือกระบวนการ ERP

## สารบัญ

1 สถาปัตยกรรมและข้อตกลงข้อมูล

2 ความสัมพันธ์และตารางหลัก

3 องค์กร ผู้ใช้ และการเข้าร่วมทีม

4 ลูกค้า สถานที่ และอุปกรณ์

5 งานนัดหมายและการมอบหมาย

6 บริการจริง รูปภาพ และ OCR

7 รอบดูแลและการแจ้งเตือน

8 สิทธิ์และการแยกข้อมูลร้าน

9 ธุรกรรม การส่งซ้ำ และการทำงานออฟไลน์

10 สัญญาการทำงานของ API

11 ดัชนี การค้นหา และเวลา

12 ตัวอย่างครบวงจรและเกณฑ์ยอมรับ

13 การดูแลระบบและการส่งต่อพัฒนา

14 เอกสารอ้างอิงทางเทคนิค

ใช้ Heading ของ Word สำหรับ Navigation Pane และสร้างสารบัญพร้อมเลขหน้าเมื่อปรับเนื้อหาฉบับสุดท้าย

## 1 สถาปัตยกรรมและข้อตกลงข้อมูล

เส้นทางหลักคือ แอปมือถือ → HTTPS API → PostgreSQL และพื้นที่ไฟล์ส่วนตัว ส่วน worker ทำงานแจ้งเตือนและ OCR เบื้องหลัง การเริ่มต้นอาจวาง API database และ worker บนเครื่องเดียวกัน แต่แยกบัญชี สิทธิ์ และกระบวนการ พร้อมสำรองข้อมูลออกนอกเครื่อง

### 1.1 แบบข้อมูลพื้นฐาน

| ข้อตกลง | แนวทาง |
| --- | --- |
| Primary key | UUID สร้างฝั่ง server หรือ client สำหรับ draft ใช้รูปแบบเดียวกันทั้งระบบ |
| Tenant key | organization_id NOT NULL บนทุกตารางธุรกิจของร้าน |
| Audit fields | created_at updated_at เป็น timestamptz และ created_by_member_id เมื่อมีผู้กระทำ |
| Version | integer เริ่ม 1 เพิ่มทุกครั้งที่แก้ข้อมูล ใช้ตรวจ stale update |
| วันที่รอบดูแล | date ตามปฏิทินร้าน ไม่เก็บเป็นเวลาตีศูนย์ UTC |
| วันเวลานัดและบริการ | timestamptz รับ ISO 8601 พร้อม offset และแสดงตาม timezone ร้าน |
| ข้อมูลไม่ทราบ | NULL สำหรับ model serial วันที่ติดตั้งและ GPS ห้ามใช้ข้อความสมมติแทน |
| สถานะ | text พร้อม CHECK สำหรับค่าที่อนุญาต ปรับด้วย migration |
| ข้อมูลขยาย | jsonb เฉพาะ metadata OCR audit และ outbox ไม่ใช้แทนความสัมพันธ์หลัก |

กำหนด timezone ร้านเริ่มต้น Asia/Bangkok เก็บปีในฐานข้อมูลเป็นคริสต์ศักราช ส่วน UI แสดงพุทธศักราชได้ โทรศัพท์ normalize เป็นรูปแบบสากลโดยไม่ทำลายค่าที่ผู้ใช้กรอก ชื่อบุคคลและที่อยู่เก็บเป็น text รองรับภาษาไทย

### 1.2 การอ้างอิงข้ามตาราง

ทุกตาราง tenant มี UNIQUE (organization_id, id) และ foreign key ของข้อมูลร้านใช้องค์ประกอบทั้ง organization_id และ id เช่น งานอ้างอิงสถานที่ด้วย (organization_id, location_id) ไม่ใช้ id เพียงอย่างเดียว การตรวจ API และ RLS ต้องทำร่วมกับ constraint นี้

ตาราง users เป็นตัวตนกลาง ส่วน organization_members เป็นสิทธิ์ในแต่ละร้าน ห้ามใช้ user_id แทน member_id ในประวัติธุรกิจ เพราะผู้ใช้คนเดียวอาจมีคนละบทบาทในแต่ละร้าน

## 2 ความสัมพันธ์และตารางหลัก

Organization มีสมาชิก ลูกค้า และงาน ลูกค้ามีหลายสถานที่ สถานที่มีหลายอุปกรณ์ Job คือแผนงาน ServiceEvent คือการบริการจริงที่มีรายการรายเครื่อง MaintenanceSchedule คือรอบดูแลของเครื่อง ไม่ผูกกับช่างผู้ให้บริการครั้งก่อน

| ความสัมพันธ์ | จำนวน | ผลต่อการใช้งาน |
| --- | --- | --- |
| organizations → organization_members | 1 ต่อหลาย | กำหนดสิทธิ์ร้านผ่านสมาชิก |
| customers → customer_locations | 1 ต่อหลาย | ลูกค้าคนเดียวมีบ้าน ร้าน หรือโกดังได้ |
| customer_locations → equipment | 1 ต่อหลาย | เครื่องผูกกับสถานที่จริง |
| jobs → job_equipment | 1 ต่อหลาย | รายการเครื่องที่คาดว่าจะทำ ว่างได้ |
| jobs → service_events | 1 ต่อหลาย | รองรับบริการหลายรอบและบันทึกเพิ่มเติมภายหลัง |
| service_events → service_event_equipment | 1 ต่อหลาย | ผลจริง ประเภทบริการ และข้อสังเกตรายเครื่อง |
| equipment → maintenance_schedules | 1 ต่อหลาย | แยกรอบตามประเภทบริการ |
| maintenance_schedules → maintenance_cycles | 1 ต่อหลาย | รักษาประวัติรอบเดิมเมื่อเกิดรอบใหม่ |
| maintenance_cycles ↔ jobs | ผ่าน maintenance_bookings | หนึ่งนัดครอบคลุมหลายรอบได้ |

จำนวน ServiceEvent ต่อ Job ออกแบบให้เป็นหลายรายการ แต่ MVP ใช้หนึ่งรายการจากการปิดงานตามปกติ งานเพิ่มเติมหลังปิดให้สร้างงานใหม่ก่อน เว้นแต่พัฒนา flow บันทึกเพิ่มเติมพร้อมสิทธิ์และ audit อย่างชัดเจน

| กลุ่ม | ตาราง |
| --- | --- |
| ตัวตนและทีม | users organization_members organizations organization_join_links auth_sessions |
| ข้อมูลบริการที่ใช้ซ้ำ | customers customer_locations equipment |
| แผนงาน | jobs job_equipment job_assignments job_state_changes |
| บริการจริงและภาพ | service_events service_event_equipment media_assets service_photos equipment_photos ocr_requests |
| การกลับมาดูแล | maintenance_schedules maintenance_cycles maintenance_bookings maintenance_contact_logs |
| แจ้งเตือนและความน่าเชื่อถือ | notifications notification_deliveries device_tokens outbox_events idempotency_keys audit_logs |

พจนานุกรมต่อไปนี้แสดง field ธุรกิจและข้อกำหนดสำคัญ ให้เติม id tenant audit fields และ version ตามหัวข้อ 1 ในตารางที่เกี่ยวข้อง ไม่เก็บ GPS หรือเส้นทางการเคลื่อนที่บน Job ServiceEvent หรือสมาชิก

## 3 องค์กร ผู้ใช้ และการเข้าร่วมทีม

### 3.1 organizations

หนึ่งแถวต่อหนึ่งร้าน

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| name | text NOT NULL | ชื่อร้าน |
| timezone | text NOT NULL | เริ่มต้น Asia/Bangkok |
| status | text NOT NULL | active หรือ suspended |
| contact_phone | text NULL | เบอร์ติดต่อร้าน |
| reminder_lead_days | integer NOT NULL | ข้อเสนอเริ่ม 7 วัน ต้องไม่ติดลบ |

ข้อเสนอ MVP ให้มี Owner อย่างน้อยหนึ่งคน การนำ Owner คนสุดท้ายออกถูกปฏิเสธ เว้นแต่โอนสิทธิ์สำเร็จในธุรกรรมเดียวกัน ร้านถูกระงับทำให้สมาชิกทั้งหมดเข้าข้อมูลธุรกิจไม่ได้

### 3.2 users และ auth_sessions

users เก็บตัวตนกลาง ส่วน session จัดการอุปกรณ์ที่เข้าสู่ระบบ

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| users auth_subject | text UNIQUE NOT NULL | ตัวอ้างอิงผู้ให้บริการยืนยันตัวตน |
| users display_name | text NOT NULL | ชื่อเรียก |
| users phone_verified_at | timestamptz NULL | ยืนยันเบอร์แล้วเมื่อไร |
| users status | text NOT NULL | active หรือ disabled |
| sessions token_hash | text UNIQUE NOT NULL | เก็บ hash ของ refresh token ไม่เก็บ raw token |
| sessions expires_at revoked_at | timestamptz | หมดอายุหรือเพิกถอน |
| sessions user_id | uuid FK NOT NULL | เจ้าของ session |

OTP ส่งจริงต้องมี rate limit อายุใช้งาน จำนวนครั้งที่ลอง และไม่บันทึกรหัสใน log การสมัครช่างกรอกชื่อเป็น UX ขั้นต่ำ แต่ก่อนเข้าข้อมูลต้องมีตัวตนที่พิสูจน์และกู้คืนได้ วิธี login ของช่าง SMS หรือทางเลือกอื่นต้องกำหนดก่อนพัฒนา auth โดยไม่เพิ่มฟอร์มธุรกิจที่ไม่จำเป็น

### 3.3 organization_members

เชื่อมผู้ใช้กับร้านและเก็บบทบาทโดยไม่ลบประวัติ

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| user_id | uuid FK NOT NULL | ผู้ใช้กลาง |
| role | text CHECK | owner หรือ technician |
| status | text CHECK | pending active rejected suspended removed |
| display_name | text NOT NULL | ชื่อเรียกในร้าน |
| approved_by_member_id | uuid FK NULL | Owner ที่อนุมัติ |
| approved_at removed_at | timestamptz NULL | เวลาการเปลี่ยนสิทธิ์ |

UNIQUE (organization_id, user_id) การขอเข้าร่วมซ้ำคืน membership เดิม ไม่เพิ่มแถวซ้ำ pending เห็นชื่อร้านและสถานะคำขอตนเองเท่านั้น ไม่เห็นลูกค้าหรืองาน suspended และ removed หยุดสิทธิ์ทันทีและคงแถวอ้างอิงประวัติ

### 3.4 organization_join_links

ลิงก์และ QR ของร้านใช้ซ้ำได้กับช่างหลายคน

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| token_hash | text UNIQUE NOT NULL | hash ของ token สุ่มที่เดายาก |
| token_ciphertext | text NOT NULL | token เข้ารหัสเพื่อให้ Owner แชร์ลิงก์เดิมได้ |
| status | text CHECK | active closed revoked |
| generation | integer NOT NULL | รุ่นของลิงก์ |
| rotated_at | timestamptz NULL | เวลา reset |
| created_by_member_id | uuid FK NOT NULL | Owner ผู้สร้าง |

partial UNIQUE organization_id WHERE status = active ให้มีลิงก์ใช้งานหนึ่งชุดต่อร้าน Reset revoke ชุดเดิมและสร้างชุดใหม่ในธุรกรรมเดียว pending เดิมยังอยู่รอพิจารณา QR เข้ารหัส URL เดียวกับ Join Link การเปิด URL ไม่ได้ทำให้เป็นสมาชิก active เก็บ encryption key แยกจากฐานข้อมูล เฉพาะ API ที่ตรวจ Owner เท่านั้นถอดรหัสเพื่อแชร์ และห้ามเก็บ token ใน log

### 3.5 การอนุมัติและจัดการทีม

Owner สมัครและยืนยันตัวตนแล้ว server สร้าง organizations และ membership owner active พร้อม Join Link ในธุรกรรมเดียว ช่างเปิดลิงก์และขอเข้าร่วมได้เฉพาะลิงก์ที่ active Owner อนุมัติหลังตรวจคำขอและสมาชิกใหม่ได้รับสิทธิ์เมื่อ commit สำเร็จ

เมื่อระงับหรือนำช่างออก งานที่ยังไม่เสร็จต้องแสดงเตือน Owner ให้มอบหมายใหม่ ห้ามเปลี่ยนชื่อผู้ทำบริการในอดีต งาน in_progress ไม่ถูกย้ายอัตโนมัติให้ช่างคนอื่น ข้อเสนอคือ Owner เลือกพักหรือเปลี่ยนผู้รับงานพร้อมเหตุผลและตรวจ draft ค้างก่อน

## 4 ลูกค้า สถานที่ และอุปกรณ์

### 4.1 customers

ข้อมูลลูกค้าของร้าน ใช้ซ้ำในทุกนัด

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| name | text NOT NULL | ชื่อบุคคลหรือบริษัท |
| phone_raw phone_normalized | text NULL | ค่าต้นฉบับและค่าค้นหา |
| customer_type | text CHECK | person หรือ company |
| note | text NULL | ข้อมูลที่ช่วยให้บริการ |
| archived_at | timestamptz NULL | ซ่อนจากการสร้างงานใหม่ |

ข้อเสนอ UI สร้างลูกค้าใหม่จากชื่อและเบอร์ แต่ schema อนุญาตไม่มีเบอร์กรณีลูกค้าองค์กรมีผู้ติดต่ออื่น ห้าม unique เบอร์โทรเพราะหลายคนอาจใช้เบอร์ร่วมกัน เตือนข้อมูลคล้ายกันแทนการรวมอัตโนมัติ

### 4.2 customer_locations

พิกัดเป็นของสถานที่ลูกค้าเท่านั้น

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| customer_id | uuid FK NOT NULL | ลูกค้าเจ้าของสถานที่ |
| label address_text | text | ชื่อสถานที่ NOT NULL และที่อยู่ NULL ได้ |
| latitude longitude | numeric(9,6) NULL | ละติจูดและลองจิจูด |
| gps_accuracy_m | numeric NULL | ความแม่นยำจากอุปกรณ์ |
| location_source | text NULL | current_location หรือ manual_pin |
| location_captured_at | timestamptz NULL | เวลาบันทึกพิกัด |
| location_captured_by | uuid FK NULL | สมาชิกที่กดบันทึก |
| archived_at | timestamptz NULL | สถานที่เลิกใช้ |

CHECK latitude ระหว่าง -90 ถึง 90 longitude ระหว่าง -180 ถึง 180 และต้องมีหรือไม่มีทั้งคู่ accuracy ต้องไม่ติดลบ current_location รับ accuracy ได้ manual_pin ว่างได้ การแก้พิกัดต้องมี version และ audit ผู้ใช้ยืนยันก่อนแทนพิกัดเดิม ไม่มี endpoint รับพิกัดช่างต่อเนื่อง

### 4.3 equipment

เครื่องที่ร้านรู้จัก ไม่ต้องมีประวัติติดตั้ง

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| location_id | uuid FK NOT NULL | สถานที่ของเครื่อง |
| category display_name | text | category NOT NULL ชื่อเรียก NULL ได้ |
| brand model serial_number | text NULL | ผลที่ผู้ใช้ยืนยันแล้ว |
| serial_normalized | text NULL | ค่าช่วยค้นหาไม่ใช่ global key |
| installed_on | date NULL | วันที่ติดตั้ง optional |
| installation_note | text NULL | ข้อมูลติดตั้งที่ทราบ |
| status | text CHECK | active retired archived |
| qr_code_token | text UNIQUE NULL | รองรับ sticker ในอนาคต ไม่บังคับ |

รุ่นและ Serial ว่างได้ ห้ามใช้ Serial เป็น primary key หรือ unique ทั้งระบบ แสดง candidate ซ้ำในสถานที่เดียวกันให้ผู้ใช้ยืนยัน การย้ายเครื่องข้ามสถานที่เป็นฟีเจอร์อนาคต ต้องเก็บประวัติการย้ายและห้ามเปลี่ยน snapshot ของบริการเก่า

### 4.4 การรักษาข้อมูลที่เคยใช้

Job และ ServiceEvent อ้างอิงลูกค้าและสถานที่ พร้อม snapshot ชื่อ ที่อยู่ ชื่อเครื่องและ model ที่ใช้ ณ เวลานั้น เพื่อไม่ให้การแก้ master data เปลี่ยนความหมายของประวัติ เก็บ snapshot เท่าที่จำเป็นและอยู่ภายใต้นโยบายการเก็บข้อมูลส่วนบุคคล

การ archive ไม่ทำให้ข้อมูลและประวัติถูกลบ การลบถาวรต้องเป็นกระบวนการแยกที่ตรวจความสัมพันธ์และนโยบายเก็บข้อมูล ไม่เปิด cascade delete จาก customer ไปยัง service history ใน flow ปกติ

## 5 งานนัดหมายและการมอบหมาย

### 5.1 jobs

แผนงานของสถานที่หนึ่งแห่ง สร้างได้แม้ยังไม่รู้เครื่อง

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| customer_id location_id | uuid FK NOT NULL | ต้องเป็นสถานที่ของลูกค้ารายนี้ |
| job_type | text CHECK | installation repair inspection maintenance other |
| source | text CHECK | owner_created maintenance technician_adhoc |
| scheduled_start scheduled_end | timestamptz NULL | เวลานัด; end ต้องหลัง start |
| estimated_equipment_count | integer NULL | จำนวนประมาณ ต้องมากกว่าศูนย์ |
| description | text NULL | อาการและสิ่งที่ลูกค้าร้องขอ |
| status | text CHECK | unassigned scheduled in_progress completed cancelled |
| current_assignee_member_id | uuid FK NULL | ผู้รับงานปัจจุบัน |
| started_at completed_at | timestamptz NULL | เวลาสถานะ ไม่ใช่ GPS |
| cancel_reason cancelled_at | text และ timestamptz NULL | เหตุผลและเวลายกเลิก |

unassigned ไม่มีผู้รับงาน scheduled มีผู้รับงานที่ active วันนัดว่างได้และแสดงยังไม่กำหนดเวลา เริ่มงานได้เฉพาะผู้รับงานตามสิทธิ์ งาน completed ต้องอ้างอิงบริการจริง ส่วน cancelled ไม่สร้างบริการสมมติ

### 5.2 job_equipment

รายการเครื่องที่คาดว่าจะทำในงาน ไม่ใช่ผลการทำจริง

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| job_id equipment_id | uuid FK NOT NULL | งานและเครื่องในสถานที่เดียวกัน |
| requested_service_type | text NOT NULL | บริการที่วางแผน |
| request_note | text NULL | ข้อสังเกตก่อนทำ |

UNIQUE (organization_id, job_id, equipment_id, requested_service_type) อนุญาตไม่มีแถวตอนสร้าง Job ช่างเพิ่มอุปกรณ์เมื่อไปถึงได้ การมีเครื่องในแผนไม่ได้ทำให้เกิดประวัติหรือรอบใหม่จนกว่าจะบันทึกบริการจริง

### 5.3 job_assignments และ job_state_changes

เก็บประวัติการเปลี่ยนช่าง เวลา และสถานะ

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| assignments job_id | uuid FK NOT NULL | งานที่มอบหมาย |
| assignments assignee_member_id | uuid FK NOT NULL | ช่างที่เคยได้รับงาน |
| assignments assigned_at ended_at | timestamptz | ช่วงการมอบหมาย |
| assignments assigned_by reason | uuid FK และ text | ผู้เปลี่ยนและเหตุผล |
| state_changes from_status to_status | text | สถานะก่อนและหลัง |
| state_changes actor_member_id | uuid FK NOT NULL | ผู้เปลี่ยนสถานะ |
| state_changes reason changed_at | text NULL และ timestamptz | เหตุผลและเวลา |

partial UNIQUE (organization_id, job_id) WHERE ended_at IS NULL ให้หนึ่งงานมีผู้รับงานปัจจุบันหนึ่งคน jobs.current_assignee ต้องตรงกับ assignment ที่เปิดอยู่ อัปเดตทั้งสองในธุรกรรมเดียว การเลื่อนเวลานัดและเปลี่ยนช่างต้องเพิ่ม version และส่งแจ้งเตือนแก่ผู้เกี่ยวข้อง

### 5.4 การเปลี่ยนสถานะ

| จาก | ไป | ผู้กระทำและเงื่อนไข |
| --- | --- | --- |
| unassigned | scheduled | Owner มอบหมายสมาชิก active |
| scheduled | unassigned | Owner ถอน assignment ก่อนเริ่ม |
| scheduled | in_progress | ช่างผู้รับงาน หรือ Owner ที่ทำบริการเอง |
| in_progress | completed | ผู้ทำบริการ ส่งผลจริงอย่างน้อยหนึ่งเครื่องครบ |
| unassigned scheduled | cancelled | Owner ระบุเหตุผล |
| in_progress | cancelled | Owner จัดการ draft ก่อน ไม่ลบผลบริการที่ commit แล้ว |
| completed cancelled | สถานะเดิม | ห้าม reopen ตรง ๆ ใน MVP ใช้งานใหม่หรือการแก้ไขพร้อม audit |

ข้อเสนอ MVP กรณีทำไม่ครบ ให้ปิดงานพร้อมผลรายเครื่อง done not_done deferred และเหตุผล เครื่องที่ไม่ได้ทำต้องคงรอบเดิม และ Owner สร้างงานติดตามจากรายการนั้นได้ กรณีไม่มีเครื่องที่ทำสำเร็จเลยให้ยกเลิกหรือเลื่อน ไม่แสดงเป็นงานสำเร็จ

## 6 บริการจริง รูปภาพ และ OCR

### 6.1 service_events

หัวรายการของการบริการจริงแยกจาก Job

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| job_id | uuid FK NULL | NULL ได้สำหรับงานหน้างานที่ไม่สร้าง Job |
| customer_id location_id | uuid FK NOT NULL | สถานที่ที่ให้บริการจริง |
| performed_by_member_id | uuid FK NOT NULL | ผู้ทำงานจริง คงไว้เมื่อเปลี่ยนช่างในอนาคต |
| occurred_at | timestamptz NOT NULL | เวลาทำบริการที่ผู้ใช้ระบุ |
| committed_at | timestamptz NOT NULL | เวลาที่ server ยืนยันบันทึก |
| general_note | text NULL | สรุปงาน |
| status | text CHECK | committed หรือ voided |
| client_event_id | uuid NOT NULL | ตัวระบุที่ client ใช้ส่งซ้ำ |

UNIQUE (organization_id, client_event_id) ไม่เก็บ draft ที่ยังไม่ยืนยันเป็นประวัติสำเร็จ หาก job_id ไม่ว่าง customer location ต้องตรงกับงาน การแก้ประวัติใช้ version และ audit ไม่เปลี่ยน performed_by เพียงเพราะงานรอบใหม่ใช้คนอื่น

### 6.2 service_event_equipment

รายละเอียดบริการจริงแยกแต่ละเครื่อง

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| service_event_id equipment_id | uuid FK NOT NULL | รายการบริการและเครื่องในสถานที่นี้ |
| service_type | text NOT NULL | ประเภทบริการที่ทำจริง |
| outcome | text CHECK | done not_done deferred |
| work_note problem_note | text NULL | สิ่งที่ทำและปัญหาที่พบ |
| not_done_reason | text NULL | ต้องมีเมื่อไม่ได้ทำ |
| equipment_snapshot | jsonb NOT NULL | ชื่อประเภท brand model serial ที่จำเป็น |
| next_due_on | date NULL | วันดูแลถัดไปที่ยืนยัน ณ ครั้งนี้ |

UNIQUE (organization_id, service_event_id, equipment_id, service_type) หนึ่งเครื่องมีบริการจริงหลายประเภทได้ เฉพาะ outcome = done เท่านั้นที่เลื่อนรอบประเภทนั้น not_done และ deferred ไม่สร้างรอบใหม่ การตั้ง no reminder ต้องเป็นคำสั่งชัดเจน ไม่อนุมานจาก field ที่ไม่ได้ส่ง

### 6.3 media_assets

ทะเบียนไฟล์ส่วนตัว เก็บสถานะ upload แยกจากบริการ

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| storage_key | text UNIQUE NOT NULL | key ของ object storage ไม่ใช่ public URL |
| mime_type byte_size checksum | text bigint text | ชนิด ขนาด และ checksum ที่ตรวจแล้ว |
| status | text CHECK | pending_upload processing ready failed deleted |
| gps_metadata_stripped_at | timestamptz NULL | เวลา strip metadata ตำแหน่ง |
| uploaded_by_member_id | uuid FK NOT NULL | ผู้อัปโหลด |
| failure_code | text NULL | สาเหตุที่ต้อง retry |

ใช้ signed URL อายุสั้นหลังตรวจสิทธิ์ ตรวจชนิดไฟล์จริง ขนาด และ strip GPS metadata รวม thumbnail ก่อนให้ดาวน์โหลด ห้าม log raw EXIF ที่มีพิกัด ภาพเก็บคุณภาพเพียงพอสำหรับอ่านป้ายและงานบริการ

### 6.4 service_photos และ equipment_photos

เชื่อมภาพกับบริการจริงหรือข้อมูลเครื่อง

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| service_photos service_event_equipment_id | uuid FK NOT NULL | รายการบริการรายเครื่อง |
| service_photos media_asset_id | uuid FK NOT NULL | ไฟล์ภาพ |
| service_photos photo_type | text CHECK | before after issue other |
| equipment_photos equipment_id | uuid FK NOT NULL | เครื่องเจ้าของภาพ |
| equipment_photos media_asset_id | uuid FK NOT NULL | ไฟล์ภาพป้ายหรือตัวเครื่อง |
| equipment_photos photo_type | text CHECK | nameplate equipment other |
| ทั้งสอง sort_order caption | integer และ text NULL | ลำดับและคำอธิบาย |

UNIQUE คู่รายการเจ้าของภาพและ media_asset_id ภายในร้าน เลือกเครื่องเป้าหมายก่อนเชื่อมภาพ ไม่ปล่อยภาพลอยที่เข้าถึงทุกเครื่อง ภาพ pending แสดงรอส่งและ retry ไม่แสดงพร้อมดูจนผ่านการประมวลผล

### 6.5 ocr_requests

งานอ่านภาพที่ทำเบื้องหลัง

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| media_asset_id equipment_id | uuid FK | ภาพ NOT NULL เครื่อง NULL ได้ก่อนสร้าง |
| status | text CHECK | queued running succeeded failed cancelled |
| provider_request_id | text NULL | ตัวอ้างอิงงาน AI |
| suggested_fields confidence | jsonb NULL | ค่าที่อ่านได้และระดับความมั่นใจ |
| accepted_fields | jsonb NULL | เฉพาะค่าที่ผู้ใช้ยืนยัน |
| attempt_count error_code | integer และ text NULL | จำนวน retry และข้อผิดพลาด |

OCR ล้มเหลวไม่ rollback บริการและไม่บังคับต้องรอ worker OCR ไม่เขียนทับค่า master โดยอัตโนมัติ เมื่อผลมาช้าต้องแสดงข้อเสนอให้ผู้ใช้ตรวจ ไม่ทับ field ที่เพิ่งแก้และไม่สร้างเครื่องใหม่เอง

### 6.6 งานหน้างานและข้อมูลขั้นต่ำ

ช่าง active สร้างลูกค้า สถานที่ เครื่อง และ ServiceEvent หน้างานในร้านของตนเองได้ด้วย flow สั้น ไม่มี Job ล่วงหน้าก็ทำได้ หากร้านต้องการนับในรายการงาน server สร้าง Job source technician_adhoc และปิดพร้อม ServiceEvent ในธุรกรรมเดียว ต้องไม่สร้างทั้งแบบไม่มี Job และแบบมี Job จากคำขอเดียวกัน

ข้อเสนอข้อมูลขั้นต่ำปิดงานคือสถานที่ ผู้ทำบริการ เวลาบริการ และผล done อย่างน้อยหนึ่งเครื่อง รูปก่อนหลังเป็นคำแนะนำ ไม่เป็นเงื่อนไขบังคับของทุกประเภทธุรกิจ หากต้องบังคับรูปภายหลังให้ตั้งค่าตามประเภทบริการอย่างชัดเจน

## 7 รอบดูแลและการแจ้งเตือน

### 7.1 maintenance_schedules

นโยบายรอบดูแลของอุปกรณ์แยกตามประเภทบริการ

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| equipment_id service_type | uuid FK และ text | เครื่องและประเภทบริการ |
| enabled | boolean NOT NULL | เปิดหรือหยุดเตือน |
| interval_months | integer NULL | 3 6 12 หรือเดือนที่กำหนดเอง |
| schedule_mode | text CHECK | months หรือ custom_date |
| last_done_item_id | uuid FK NULL | บริการ done ล่าสุดที่ใช้เป็นฐาน |
| current_cycle_id | uuid FK NULL | รอบปัจจุบัน |

UNIQUE (organization_id, equipment_id, service_type) รอบไม่ผูก technician interval_months มากกว่าศูนย์เมื่อ mode months custom_date ต้องมีวันใน cycle no reminder ตั้ง enabled false และปิดวงจรปัจจุบันด้วยเหตุผล ไม่ลบประวัติรอบเก่า

### 7.2 maintenance_cycles

หนึ่งแถวต่อรอบที่ต้องกลับมาดูแล

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| schedule_id | uuid FK NOT NULL | นโยบายรอบของเครื่อง |
| basis_service_item_id | uuid FK NULL | บริการจริงที่สร้างรอบนี้ |
| due_on | date NOT NULL | วันถึงกำหนด |
| status | text CHECK | open fulfilled superseded disabled |
| fulfilled_by_item_id | uuid FK NULL | รายการ done ที่ทำให้รอบจบ |
| closed_at | timestamptz NULL | เวลาปิดรอบ |

partial UNIQUE (organization_id, schedule_id) WHERE status = open ให้มีรอบปัจจุบันหนึ่งรอบ due soon due overdue คำนวณจากวันที่ ไม่เก็บเป็น status ที่ต้องเปลี่ยนทุกวัน การแก้วัน due ก่อนทำจริงใช้ version และ audit หรือ supersede รอบเดิมพร้อมสร้างใหม่

### 7.3 maintenance_bookings และ maintenance_contact_logs

แยกการนัดและการติดต่อลูกค้าออกจากการทำบริการสำเร็จ

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| bookings cycle_id job_id | uuid FK NOT NULL | รอบและนัดที่ครอบคลุมรอบนั้น |
| bookings status | text CHECK | active cancelled fulfilled |
| bookings created_by_member_id | uuid FK NOT NULL | Owner ผู้นัด |
| contact_logs cycle_id | uuid FK NOT NULL | รอบที่ติดตาม |
| contact_logs result | text CHECK | no_answer interested call_later declined booked |
| contact_logs note next_contact_on | text NULL และ date NULL | รายละเอียดและวันติดตาม |

partial UNIQUE (organization_id, cycle_id) WHERE status = active กันนัดซ้ำหนึ่งรอบ job หนึ่งรายการครอบคลุมหลาย cycles ได้ และเครื่องทั้งหมดต้องอยู่สถานที่เดียวกัน งานถูกยกเลิกเปลี่ยน booking เป็น cancelled และให้รอบยัง open การนัดหรือการติดต่อไม่เลื่อน due_on

### 7.4 สูตรรอบถัดไป

เมื่อบริการ done ใช้ occurred_at แปลงเป็นวันที่ใน timezone ร้าน แล้วเพิ่มจำนวนเดือนตามปฏิทิน เช่น 31 สิงหาคม + 6 เดือนเป็นวันสุดท้ายของกุมภาพันธ์ ไม่แทน 6 เดือนด้วย 180 วัน custom date ใช้วันที่ผู้ใช้เลือกและต้องหลังวันบริการ

บริการใหม่ประเภทเดียวกันจะ fulfill รอบ open ที่เกี่ยวข้องและสร้างรอบใหม่ในธุรกรรมเดียว แม้ทำก่อนวัน due หากเป็น repair โดยไม่มี maintenance ของประเภทนั้นให้คงรอบล้างเดิม กรณี backdate เก่ากว่าบริการล่าสุด บันทึกประวัติได้แต่ไม่ย้อน due อัตโนมัติ Owner ต้องเลือกแก้รอบพร้อมเหตุผล

### 7.5 notifications และ notification_deliveries

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| notifications recipient_member_id | uuid FK NOT NULL | ผู้รับในร้าน |
| notifications event_type target_id | text และ uuid | ประเภทและเป้าหมายเช่น cycle job membership |
| notifications dedupe_key | text NOT NULL | UNIQUE คู่ร้าน ผู้รับ และ key |
| notifications read_at | timestamptz NULL | อ่านแล้วเมื่อไร |
| deliveries notification_id | uuid FK NOT NULL | รายการแจ้งเตือน |
| deliveries channel status | text | push queued sent failed |
| deliveries attempts next_attempt_at | integer และ timestamptz | retry และ backoff |
| device_tokens user_id token platform | uuid text text | อุปกรณ์ของผู้ใช้ ไม่ใช่สิทธิ์ร้าน |

ข้อเสนอ worker ตรวจทุกวันตาม timezone ร้าน แจ้ง Owner active ที่ช่วง 7 วันก่อนถึง วันถึง และเกินกำหนดครั้งแรกเมื่อยังไม่มี active booking ใช้ dedupe key cycle_id และ milestone ป้องกันแจ้งซ้ำ การเปลี่ยน due_on รีเซ็ต milestone ตาม version รอบแต่ต้องไม่ยิงแจ้งเตือนทุกรอบที่ worker restart

หาก worker หยุดข้ามวัน ให้ประเมินรอบ open ทั้งหมดที่เลย milestone แล้วยังไม่เคยแจ้ง เลือกแจ้งสถานะปัจจุบันหนึ่งรายการแทนส่งย้อนหลังหลายข้อความพร้อมกัน เก็บ checkpoint จาก notification ที่ commit แล้ว ไม่ถือว่าการหยิบงานสำเร็จเท่ากับส่งสำเร็จ

Push แสดงข้อความสั้น หลีกเลี่ยงชื่อ ที่อยู่ และเบอร์ลูกค้าบน lock screen การกดเปิดต้องตรวจ membership และสิทธิ์ target ใหม่เสมอ ระบบแจ้งเตือนยังทำงานได้เมื่อผู้ใช้ปฏิเสธ Push โดยมี inbox ในแอป LINE OA เป็นช่องทางอนาคต ใช้ outbox เดิมและเพิ่ม consent ก่อนส่งถึงลูกค้า

## 8 สิทธิ์และการแยกข้อมูลร้าน

| การทำงาน | Owner active | Technician active |
| --- | --- | --- |
| จัดการร้านและทีม | ได้ | ไม่ได้ |
| สร้าง นัด มอบหมายและยกเลิกงาน | ได้ | ไม่ได้ใน MVP |
| อ่านงาน | ทุกงานในร้าน | งานปัจจุบันที่ตนได้รับ |
| อ่านสถานที่ เครื่องและประวัติ | ทุกข้อมูลในร้าน | ผ่านงานที่มีสิทธิ์หรือบริการที่ตนบันทึก |
| สร้างลูกค้าและสถานที่หน้างาน | ได้ | ได้ใน flow งานหน้างาน |
| บันทึกบริการ | ได้เมื่อเป็นผู้ทำบริการ | งานตนเองหรือหน้างาน |
| แก้พิกัดและข้อมูลเครื่อง | ได้พร้อม version | เฉพาะขอบเขตงานที่ตนเข้าถึง |
| นัดจากรอบดูแล | ได้ | ไม่ได้ |
| ค้นหาและดาวน์โหลดภาพ | ขอบเขตร้าน | ขอบเขตข้อมูลที่มีสิทธิ์ |
| แก้ประวัติที่ commit แล้ว | ได้ผ่าน flow แก้ไขพร้อม audit | ข้อเสนอ MVP ขอ Owner แก้ |

ขอบเขตค้นหาประวัติของช่างในตารางนี้เป็นข้อเสนอเพื่อพัฒนาให้สอดคล้องกับ Technician First และหลักสิทธิ์เท่าที่จำเป็น เมื่อได้รับงานที่สถานที่หนึ่ง ช่างดูประวัติเครื่องในสถานที่นั้นรวมงานที่ช่างคนก่อนทำได้ ไม่ได้เปิดฐานลูกค้าทั้งร้านโดยอัตโนมัติ

### 8.1 การตรวจสิทธิ์ในทุกคำขอ

API ยืนยันตัวตน เลือกร้านจาก membership active ตรวจ role และ target แล้วจึงทำ query ห้ามเชื่อ organization_id หรือ performed_by จาก form ของ client ต้องผูกกับบริบทผู้ใช้ที่ server ตรวจแล้ว pending suspended removed และร้าน suspended ไม่ได้เข้าถึงข้อมูลธุรกิจ

ใช้ runtime database role ที่ไม่เป็น superuser ไม่เป็นเจ้าของตาราง และไม่มี BYPASSRLS เปิด RLS และ FORCE ROW LEVEL SECURITY บน tenant tables โดยแยก migration role ออกจาก runtime role เพราะเจ้าของตารางและ superuser มีพฤติกรรมข้าม RLS ตามเอกสาร PostgreSQL อ้างอิงท้ายเล่ม

บริบท tenant ตั้งแบบ transaction local หลัง API ตรวจ membership เช่นผ่าน set_config ที่มี is_local true แล้วใช้ policy อ่านค่าแบบ missing_ok เมื่อ context ไม่ครบต้อง deny การตั้ง context นี้ป้องกันข้อผิดพลาด query ข้ามร้าน แต่ไม่ใช่กลไกยืนยันตัวตนจาก client และไม่แทน role หรือ object authorization

### 8.2 การเพิกถอนสิทธิ์และภาพส่วนตัว

ตรวจ membership ปัจจุบันทุกคำขอ ไม่อาศัย role ที่ฝังใน access token จนหมดอายุอย่างเดียว worker ต้องใช้ขอบเขตร้านและสิทธิ์ที่เหมาะกับงาน ไม่ใช้ session ของช่าง เมื่อช่างถูกนำออก revoke cached access และล้างข้อมูลธุรกิจบนเครื่องเมื่อเชื่อมต่อ การสั่งล้างบนเครื่องที่ออฟไลน์รับประกันทันทีไม่ได้ จึงต้องเข้ารหัสและจำกัดอายุ cache

Media API ตรวจสิทธิ์ผ่านเจ้าของภาพก่อนออก signed URL อายุสั้น URL ที่ออกไปแล้วอาจใช้ได้จนหมดอายุ จึงต้องเลือกอายุให้สั้นและไม่แจก URL แบบสาธารณะ Query search count และข้อความ error ต้องไม่เปิดเผยว่ามีข้อมูลในร้านอื่นอยู่

## 9 ธุรกรรม การส่งซ้ำ และการทำงานออฟไลน์

### 9.1 การปิดงานแบบทั้งหมดสำเร็จหรือไม่สำเร็จ

• เริ่ม transaction และตั้ง tenant context ที่ผ่านการตรวจแล้ว

• ล็อก Job และตรวจ version สถานะ membership และผู้รับงานล่าสุด

• ล็อก maintenance schedules ที่เกี่ยวข้องตามลำดับ id เดียวกันทุกคำขอ

• ตรวจเครื่อง ผล done not_done deferred ภาพอ้างอิง และข้อมูลที่ข้ามร้านไม่ได้

• สร้าง ServiceEvent และรายการรายเครื่อง บันทึก snapshots และเชื่อม media ที่รอได้

• fulfill เฉพาะรอบที่มีการทำจริงประเภทตรงกัน แล้วสร้างรอบใหม่ตามตัวเลือกแต่ละเครื่อง

• อัปเดต Job completed พร้อม state history เมื่อเข้าเงื่อนไข และเก็บ outbox notification audit กับผล idempotency

• commit แล้วคืนผลสำเร็จพร้อม id และ version; worker ส่ง Push ภายหลัง

ไม่เรียก OCR push หรืออัปโหลดไฟล์ขนาดใหญ่ภายใน transaction การส่งแจ้งเตือนล้มเหลวไม่ทำให้บริการหาย แต่ outbox จะ retry SQL ใช้ parameterized query และ transaction ที่สั้นเพื่อไม่ล็อกงานนาน

### 9.2 idempotency_keys และ outbox_events

รองรับ client ส่งซ้ำและ worker restart โดยไม่สร้างประวัติซ้ำ

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| idempotency member_id scope key | uuid text text | UNIQUE ภายในร้าน สมาชิก scope และ key |
| idempotency request_hash | text NOT NULL | ตรวจ key เดิมแต่ข้อมูลคนละชุด |
| idempotency response_json | jsonb NULL | ผลที่ commit แล้ว ใช้คืนคำตอบเดิม |
| idempotency expires_at | timestamptz NOT NULL | ข้อเสนอเก็บอย่างน้อยช่วง offline retry |
| outbox aggregate_id event_type | uuid และ text | รายการธุรกิจและเหตุการณ์ |
| outbox payload dedupe_key | jsonb และ text UNIQUE | ข้อมูลขั้นต่ำสำหรับ worker |
| outbox status attempts | text และ integer | queued processing done failed |
| outbox available_at lease_until | timestamptz | เวลา retry และเวลาหมดสิทธิ์ worker |

ServiceEvent client_event_id มี unique ถาวรแม้ idempotency key หมดอายุ งานสร้างนัดใช้ client_job_id unique ภายในร้าน การส่ง key เดิม body ต่างกันคืน 409 การส่งซ้ำที่ commit แล้วคืนผลเดิม การส่ง Push เป็น at least once จึงอาจได้รับซ้ำจาก provider ได้ แต่ inbox ต้องมีรายการเดียว

### 9.3 Draft และ conflict

Offline draft เก็บบนเครื่องแบบเข้ารหัส มี client ids เวลาที่เกิดจริง รูปที่ยังไม่ส่ง base version และ idempotency key หลัง online ให้ตรวจ session membership assignment และ version ใหม่ก่อนส่ง Server ห้ามยอมรับสิทธิ์เก่าจากเวลาที่ draft ถูกสร้าง

ใช้ version comparison เช่น UPDATE ... WHERE id = ... AND version = expected_version หากไม่เปลี่ยนแถวคืน conflict พร้อม latest version ที่ผู้ใช้มีสิทธิ์เห็น เก็บ draft เดิมให้เปรียบเทียบ ไม่ overwrite เงียบ และไม่แสดง completed บนเครื่องจน server ยืนยัน

เมื่อ Job เปลี่ยนช่าง ยกเลิก หรือสมาชิกถูกระงับขณะ offline ให้คง draft และแสดงส่งไม่ได้พร้อมทางออกที่ Owner จัดการ ห้ามส่งต่อข้อมูลข้ามร้าน อัปโหลดรูปใช้ retry ต่อ asset และล้างไฟล์ orphan ตามระยะเวลาที่กำหนดโดยไม่ลบรูปที่เชื่อมกับประวัติแล้ว

### 9.4 การแก้ไขประวัติและรอบ

MVP ไม่ให้ช่างแก้ committed history โดยตรง Owner แก้ผ่านคำสั่งเฉพาะระบุ reason expected_version และผลกระทบรอบ หากแก้วันที่หรือเปลี่ยน outcome ต้องคำนวณผลต่อรอบและนัดที่เปิดอยู่ก่อนยืนยัน ไม่เปลี่ยนรอบใหม่ที่มีบริการภายหลังไปแล้วโดยอัตโนมัติ

### 9.5 audit_logs

บันทึกการกระทำสำคัญให้ตรวจสอบย้อนหลัง

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| actor_member_id | uuid FK NULL | ผู้ใช้; NULL ได้สำหรับระบบ |
| action entity_type entity_id | text text uuid | คำสั่งและเป้าหมาย |
| before_data after_data | jsonb NULL | เฉพาะ field ที่จำเป็น |
| reason request_id | text NULL | เหตุผลและตัวเชื่อม log |
| occurred_at | timestamptz NOT NULL | เวลาบน server |

audit append only สำหรับ runtime role ไม่เก็บ OTP token raw EXIF หรือข้อมูลลูกค้ามากเกินจำเป็น การลบและแก้รอบ การ reset link การเปลี่ยนช่าง และการเปลี่ยนสิทธิ์ต้องมี audit ระยะเก็บต้องกำหนดก่อนเปิดจริง

## 10 สัญญาการทำงานของ API

ใช้ /v1 และ JSON; organization context มาจากสมาชิกที่ตรวจแล้ว ใช้ UUID เป็น resource id ทุก mutation สำคัญรับ Idempotency-Key และ expected_version ตามประเภทคำสั่ง รายการใช้ cursor pagination ไม่คืนฐานลูกค้าทั้งร้านในครั้งเดียว

| กลุ่มและคำสั่ง | สิทธิ์ | ผลที่ server ต้องยืนยัน |
| --- | --- | --- |
| POST organizations | ผู้ใช้ยืนยันตัวตน | ร้าน owner membership และ join link |
| POST join requests | ผู้ใช้และลิงก์ active | membership pending ไม่คืนลูกค้า |
| POST members approve suspend remove | Owner | สถานะสมาชิก audit และผลต่อ assignment |
| POST join link rotate close | Owner | revoke หรือ close token ตามคำสั่ง |
| GET POST customers locations | ตามขอบเขต | ข้อมูลร้านเดียวและ duplicate warning |
| PUT location coordinates | ตามขอบเขต | บันทึกจาก explicit action พร้อม version |
| GET POST equipment | ตามขอบเขต | เครื่องในสถานที่ที่เข้าถึงได้ |
| POST jobs | Owner | แผนงานกับรายการเครื่อง optional |
| POST jobs assign reschedule cancel | Owner | version state history booking และ outbox |
| POST jobs start | ผู้รับงาน | in_progress หลังตรวจ latest assignment |
| POST jobs complete | ผู้ทำบริการ | event items รอบ และ completed ใน transaction |
| POST service events adhoc | สมาชิก active | บริการจริง หรือ Job ที่สร้างพร้อมกันแบบที่เลือก |
| POST media uploads finalize | ตามขอบเขต | asset private และสถานะ processing |
| POST OCR requests accept | ตามขอบเขต | ข้อเสนอหรือค่าที่ผู้ใช้ยืนยัน ไม่ block |
| GET maintenance cycles | Owner | due soon due overdue booked ตามวันที่ |
| POST maintenance cycles book | Owner | Job กับ active booking ที่ไม่ซ้ำ |
| POST maintenance contacts | Owner | ผลติดต่อ ไม่เปลี่ยน due_on |
| GET search notifications | ตามขอบเขต | ผลที่มีสิทธิ์และ inbox ของผู้รับ |

### 10.1 ตัวอย่างคำขอปิดงาน

ข้อมูลสำคัญคือ job_id expected_version client_event_id occurred_at และ items แต่ละ item มี equipment_id service_type outcome work_note photo_asset_ids และ next_maintenance โดย next_maintenance ระบุ mode months กับ interval_months หรือ custom_date กับ due_on หรือ none อย่างชัดเจน

Server กำหนด organization_id และ performed_by จากบริบท ห้ามรับ member ที่ client แอบระบุเป็นคนอื่น คืน service_event_id job_status next_cycles pending_media_ids และ server_committed_at ไม่คืน success ก่อน transaction commit

### 10.2 ข้อผิดพลาดที่แอปต้องแสดง

| HTTP | Error code | การตอบสนองของแอป |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | แสดงข้อผิดพลาดที่ field เก็บข้อมูลเดิม |
| 401 | SESSION_EXPIRED | ยืนยันตัวตนใหม่ก่อน sync |
| 403 | MEMBERSHIP_INACTIVE | หยุดเข้าข้อมูลและแจ้งติดต่อ Owner |
| 404 | RESOURCE_NOT_FOUND | ไม่เปิดเผย target ที่ไม่มีสิทธิ์ |
| 409 | VERSION_CONFLICT | เก็บ draft และเปรียบเทียบ latest |
| 409 | ALREADY_BOOKED | เปิดนัดเดิมแทนสร้างซ้ำ |
| 409 | IDEMPOTENCY_MISMATCH | หยุด retry body คนละชุดด้วย key เดิม |
| 422 | INVALID_STATE_TRANSITION | refresh สถานะและแสดงทางออก |
| 429 | RATE_LIMITED | รอตาม Retry-After |
| 503 | TEMPORARILY_UNAVAILABLE | เก็บ draft และ retry แบบ backoff |

Error response ใช้ code message field_errors request_id และ latest_version เมื่อเกี่ยวข้อง ข้อความแสดงผลเป็นภาษาไทย ห้ามคืนรายละเอียด SQL stack trace หรือตัวระบุร้านอื่น

## 11 ดัชนี การค้นหา และเวลา

| ตารางและ index | วัตถุประสงค์ |
| --- | --- |
| members organization_id user_id UNIQUE | ตรวจ membership และกันคำขอซ้ำ |
| customers organization_id phone_normalized | ค้นหาลูกค้าจากเบอร์ |
| locations organization_id customer_id | เปิดสถานที่ของลูกค้า |
| equipment organization_id location_id | รายการเครื่องที่หน้างาน |
| equipment organization_id serial_normalized | ค้น serial โดยไม่บังคับ unique |
| jobs organization_id assignee status scheduled_start | งานวันนี้ของช่าง |
| jobs organization_id status scheduled_start | รายการงาน Owner |
| service_events organization_id location_id occurred_at DESC | ประวัติสถานที่ |
| service_event_equipment organization_id equipment_id | ประวัติรายเครื่อง |
| maintenance_cycles organization_id status due_on | รายการรอบและ worker แจ้งเตือน |
| notifications organization_id recipient_member_id created_at DESC | inbox และรายการยังไม่อ่าน |
| outbox status available_at | หยิบงาน worker ที่พร้อมทำ |

Foreign key ไม่ได้สร้าง index บนคอลัมน์อ้างอิงให้ทุกกรณี จึงต้องออกแบบตาม query จริง Search MVP ใช้ phone normalized และ exact หรือ prefix ของ serial model brand รวมชื่อและชื่อเรียกเครื่อง ผลทั้งหมดถูกกรองสิทธิ์ก่อนนับจำนวน การค้นข้อความไทยแบบย่อยอาจเพิ่ม pg_trgm พร้อม benchmark ภายหลัง ไม่ตั้ง full text ภาษาอังกฤษแล้วอ้างว่ารองรับการตัดคำไทยครบ

วันทำงานของร้านคำนวณเป็นช่วงเริ่มวันถึงวันถัดไปตาม timezone แล้ว query scheduled_start ภายในช่วง ไม่แปลงทุกแถวด้วยฟังก์ชันก่อนกรองจน index ใช้ไม่ได้ การตั้งเวลาเดียวกันไม่ถูกห้ามโดย unique เพราะงานหนึ่งคนอาจมีเวลาประมาณ ให้ Owner เห็นคำเตือนนัดทับและยืนยันแทน

ทดสอบด้วยข้อมูลหลายร้านและข้อมูลบริการหลายปี ดู EXPLAIN ANALYZE ของงานวันนี้ ค้นหา timeline และ due list ก่อนเพิ่ม index ทุก field เป้าหมาย latency ต้องกำหนดกับขนาดข้อมูลและทรัพยากรเครื่องจริง

## 12 ตัวอย่างครบวงจรและเกณฑ์ยอมรับ

### 12.1 เปลี่ยนช่างในรอบถัดไป

ร้าน R มีลูกค้าคุณสมชาย สถานที่บ้าน L และเครื่อง E1 E2 E3 Owner สร้าง Job J1 และมอบหมายช่าง A วันที่ 10 ตุลาคม 2569 ช่าง A ทำ maintenance E1 E2 สำเร็จ ส่วน E3 deferred เพราะลูกค้าขอเลื่อน

เมื่อปิดงาน server สร้าง ServiceEvent S1 ระบุผู้ทำเป็น A และผลรายเครื่อง E1 E2 done E3 deferred สำหรับ E1 E2 เลือก 6 เดือน จึงได้ cycles due_on วันที่ 10 เมษายน 2570 E3 ไม่มีรอบใหม่จากงานนี้ งาน J1 completed พร้อมข้อความทำจริง 2 จาก 3 เครื่อง

วันที่ 3 เมษายน 2570 ระบบแจ้ง Owner ว่าใกล้ครบกำหนด Owner ติดต่อลูกค้าและสร้าง J2 วันที่ 12 เมษายน มอบหมายช่าง B โดยใช้ลูกค้า สถานที่ พิกัด และเครื่องเดิม active bookings เชื่อมสอง cycles กับ J2 ส่วน due_on ยังเป็นวันที่ 10 เมษายน

ช่าง B เห็นประวัติและรูปที่ A บันทึก เมื่อทำจริงวันที่ 12 เมษายน S2 ระบุผู้ทำเป็น B รอบเดิม fulfilled และรอบใหม่เป็น 12 ตุลาคม 2570 ประวัติ S1 ยังระบุ A ตามเดิม ถ้า J2 ถูกยกเลิกก่อนทำจริง cycles จะยัง open และ Owner นัดให้ช่างอื่นได้อีก

### 12.2 เกณฑ์ทดสอบก่อนเปิดทดลอง

| ID | เหตุการณ์ | ผลที่ต้องได้ |
| --- | --- | --- |
| B01 | ปลอม organization_id หรือ FK ไปอีกไซต์ร้าน | API ปฏิเสธและ DB constraint ป้องกัน ไม่มีข้อมูลรั่ว |
| B02 | runtime query ไม่มี tenant context | deny ไม่มีแถวธุรกิจถูกอ่านหรือเขียน |
| B03 | pending เปิดลูกค้า งาน search หรือ media | ไม่ได้ข้อมูลธุรกิจ |
| B04 | เปลี่ยนช่างจาก A เป็น B | A เข้า Job เดิมไม่ได้ B เห็นประวัติที่เกี่ยวข้องได้ |
| B05 | ส่ง complete ซ้ำพร้อมกัน 2 คำขอ | มี ServiceEvent และรอบใหม่ชุดเดียว |
| B06 | fail ระหว่างสร้างรอบและปิด Job | rollback ทั้งชุด ไม่มี completed ลอย |
| B07 | ทำ 2 จาก 3 เครื่อง | รอบใหม่เฉพาะ 2 เครื่อง done |
| B08 | OCR fail และ GPS denied | สร้างเครื่องและปิดงานได้ |
| B09 | รูปมี GPS EXIF | ไฟล์และ thumbnail ที่แจกไม่มีพิกัด metadata |
| B10 | Owner สองคนกดนัดรอบเดียวกัน | active booking หนึ่งรายการ คำขออื่นเปิดนัดเดิม |
| B11 | นัดแล้วแต่ยังไม่ทำจริง | due เดิมคงอยู่ แสดงมีนัดแล้ว |
| B12 | ยกเลิกนัด maintenance | booking cancelled cycle open |
| B13 | ทำ repair แต่รอบเดิมเป็นล้าง | รอบล้างไม่ถูกเลื่อนโดยอัตโนมัติ |
| B14 | 31 สิงหาคมเพิ่ม 6 เดือน | วันสุดท้ายกุมภาพันธ์รวมกรณีปีอธิกสุรทิน |
| B15 | offline draft หลังเปลี่ยนช่างหรือระงับ | ส่งไม่ได้ เก็บ draft และไม่ทับล่าสุด |
| B16 | worker restart หลังส่ง outbox | inbox ไม่ซ้ำ retry ได้ บริการไม่หาย |
| B17 | backdate ก่อนบริการล่าสุด | ประวัติเพิ่มได้ ไม่ย้อน due เงียบ |
| B18 | นำช่าง A ออกหลังทำงาน | ประวัติยังเป็น A ร้านและ B ใช้ต่อได้ |
| B19 | ย้ายหรือแก้ชื่อ master | snapshot งานเก่าไม่เปลี่ยน |
| B20 | สำรองและกู้คืนในระบบทดลอง | ข้อมูลและไฟล์เชื่อมกันได้ ตรวจจำนวนและประวัติผ่าน |

เกณฑ์เหล่านี้เป็นแผนทดสอบ ยังไม่ได้รันกับ backend หรือ PostgreSQL จริง ใช้เป็น release gate หลังมี migration API worker และแอปที่เชื่อมกัน

## 13 การดูแลระบบและการส่งต่อพัฒนา

### 13.1 การดูแล PostgreSQL และไฟล์

แยก development staging production พร้อมฐานข้อมูลและ secrets คนละชุด PostgreSQL รับ connection จาก API ผ่าน socket localhost หรือเครือข่ายส่วนตัวเท่านั้น ใช้ least privilege บัญชี runtime กับ migration และ backup แยกกัน ตั้งสำรองฐานข้อมูลและไฟล์ออกนอกเครื่อง เข้ารหัสและตรวจการกู้คืนเป็นระยะ

กำหนด RPO และ RTO ก่อนเปิดบริการ ข้อเสนอทดลองเริ่มสำรองทุกวันและทดสอบ restore แต่หากยอมเสียข้อมูลหนึ่งวันไม่ได้ต้องเพิ่ม WAL archive และ PITR การ backup เป็นรายวันไม่ได้หมายถึงกู้ได้ทุกจุดเวลา อัปโหลดรูปกับ database ต้องมีนโยบายสำรองที่สอดคล้องกัน

เฝ้าดู disk connection pool query ช้า deadlocks worker backlog upload failures และ backup age ตั้ง retention logs และไฟล์ orphan การสำรองต้องรวมทุก tenant ไม่เผลอถูกกรองโดย runtime RLS

### 13.2 งานส่งต่อทีมพัฒนา

• จัดทำ versioned DDL migrations จากพจนานุกรม พร้อม composite foreign keys CHECK partial UNIQUE และ indexes

• สร้างและทดสอบ tenant RLS กับ runtime role จริง รวมกรณีไม่ตั้ง contextและคงค่า connection pool

• ทำ OpenAPI request response error contract สำหรับ flow ตั้งแต่สมัครร้านจน recurring service

• พัฒนา transaction complete booking assignment และ idempotency พร้อม integration tests ที่แข่งขันพร้อมกัน

• ต่อ private file storage strip metadata upload retry และ OCR ที่ไม่ขวางบริการ

• ต่อ worker outbox due milestones inbox และ push พร้อม dedupe และ retry

• เชื่อมต้นแบบ UI กับ API ทดสอบ offline draft conflict และผู้ใช้ถูกเพิกถอนสิทธิ์

• ทดสอบ restore และทำ pilot ร้านจริงก่อนเปิดหลายร้าน

### 13.3 รายละเอียดที่ต้องกำหนดก่อนเปิดจริง

เลือกวิธียืนยันและกู้บัญชีช่าง ระยะอายุ session และ offline cache นโยบายเก็บข้อมูลส่วนบุคคลและ audit ช่องทาง Push SMS และพื้นที่ไฟล์ กำหนดค่า lead days และการเตือนค้าง รวมถึงวิธีแก้ประวัติที่มีรอบใหม่แล้ว รายการเหล่านี้ไม่เปลี่ยนหลัก GPS optional installation หรือ AI never blocks

ข้อเสนอด้าน role search scope รูป optional การปิดงานบางเครื่อง และ cadence แจ้งเตือนในเอกสารนี้เป็น baseline ทางวิศวกรรมสำหรับ MVP ให้ทีมผลิตภัณฑ์ใช้ในการตรวจ flow ทดลองก่อนล็อก API และ migration

## 14 เอกสารอ้างอิงทางเทคนิค

ตรวจเอกสารทางการ PostgreSQL 16 วันที่ 2 ตุลาคม 2569 ใช้ยืนยันพฤติกรรมของฐานข้อมูล ส่วนชื่อ field และกติกาธุรกิจในเล่มเป็นการออกแบบเฉพาะระบบนี้

Row Security Policies

https://www.postgresql.org/docs/16/ddl-rowsecurity.html

Constraints

https://www.postgresql.org/docs/16/ddl-constraints.html

Date Time Types

https://www.postgresql.org/docs/16/datatype-datetime.html

Explicit Locking

https://www.postgresql.org/docs/16/explicit-locking.html

## 15 สถาปัตยกรรม Subscription และ Platform Console

เพิ่ม billing และ platform administration เป็น bounded modules ที่ใช้ PostgreSQL เดิมได้แต่แยก schema business billing และ platform พร้อม runtime roles migration role และ worker role ตามหน้าที่ รายละเอียดเดิมในหัวข้อ 1 ถึง 14 ใช้ต่อร่วมกับ entitlement checks ในส่วนนี้

organization.status active suspended closed แยก subscription lifecycle; เพิ่ม closed ใน CHECK จากเดิม ตัวตนผู้ดูแลอยู่ platform_accounts ไม่ใส่ role admin ใน organization_members การปิดร้านและการลบข้อมูลไม่ใช่สถานะเดียวกัน

### 15.1 การเชื่อมความสัมพันธ์

| ความสัมพันธ์ | ข้อกำหนด |
| --- | --- |
| Organization → Subscription | หนึ่ง subscription หลักต่อร้าน เก็บ periods และ changes เป็นประวัติ |
| Plan → PlanVersion → PriceVersion | publish แล้ว immutable มีหลายราคาแยก currency และ interval |
| Subscription → SubscriptionPeriod | หลายรอบ ช่วงไม่ซ้อน paid trial grace ตาม source |
| Invoice → Payments → Allocations | invoice หนึ่งฉบับมีหลาย attempt และหลาย partial payment ได้ |
| Payment → Refunds | คืนบางส่วนได้ ยอดรวมไม่เกิน settled_amount |
| PlatformAccount → Roles | หลายบทบาทผ่าน RBAC ไม่มี tenant owner อัตโนมัติ |
| SupportTicket → SupportAccessGrant | grant มี tenant scope target เวลา consent และ approver |
| Organization → DataRequests | export closure deletion และ restore suppression log |

ตาราง billing ที่เป็นของร้านทุกแถวมี organization_id และ composite FK เช่นเดิม ตาราง global plan หรือ platform_accounts ไม่ใส่ tenant key ปลอม API admin ต้องตรวจ permission เฉพาะโมดูลก่อนเข้าถึงต่างร้าน ไม่ใช้ app role ที่ BYPASSRLS แล้วปล่อย query ทั่วไป

กำหนด actor type tenant_member platform_account system แยกใน audit โดยมี actor_member_id และ actor_platform_account_id ที่ NULL ได้ พร้อม CHECK ให้ตรง type Runtime tenant role ห้าม insert platform actor เองและผู้ดูแลไม่ใช้ membership ของร้านในการทำธุรกรรม

## 16 ตารางแพ็กเกจ สมาชิก และสิทธิ์

### 16.1 plans และ plan_versions

รายการแพ็กเกจกลางและเวอร์ชันของสิทธิ์

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| plans code name status | text | code UNIQUE; draft active archived |
| versions plan_id version_no | uuid และ integer | UNIQUE คู่ plan กับ version |
| versions status published_at | text timestamptz | draft published archived |
| versions trial_days grace_days | integer NOT NULL | ค่าที่เผยแพร่ ต้องไม่ติดลบ |
| versions entitlements | jsonb NOT NULL | schema ตรวจ quota และ feature keys |
| versions published_by | uuid FK NULL | ผู้ดูแลที่เผยแพร่ |

สิทธิ์หลักใช้ keys technician_seats storage_bytes ocr_per_period; unlimited ระบุเป็น NULL ใน schema ไม่ใช้ -1 Snapshot ที่ publish ห้าม UPDATE ด้วย runtime grant การเปลี่ยนสร้างเวอร์ชันใหม่ archived ไม่ทำให้ paid periods เดิมเสียสิทธิ์

### 16.2 price_versions

ราคาของเวอร์ชันแพ็กเกจ แยกตามรอบและสกุลเงิน

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| plan_version_id | uuid FK NOT NULL | เวอร์ชันสิทธิ์ |
| currency | char(3) NOT NULL | เช่น THB ไม่สมมติทุกสกุลมี 2 ทศนิยม |
| amount_minor | bigint NOT NULL | จำนวนในหน่วยย่อยตาม currency ไม่ใช้ float |
| billing_interval | text CHECK | month หรือ year |
| status effective_from | text timestamptz | draft published archived และเวลาเริ่ม |
| tax_behavior tax_config_version | text uuid NULL | exclusive inclusive none ตามนโยบายที่ยืนยัน |
| provider_price_ref | text NULL | mapping ฝั่ง gateway |

UNIQUE provider กับ external price ref เมื่อมี; ราคาเผยแพร่แล้วไม่แก้ย้อนหลัง ข้อมูล provider เก็บ mapping แยกถ้ามีหลาย provider ราคาในภาพต้นแบบเป็นตัวอย่าง ไม่ใส่เป็น seed production โดยอัตโนมัติ

### 16.3 subscriptions

สถานะสมาชิกหลักของร้าน ไม่ลบเมื่อเปลี่ยน Owner

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| organization_id | uuid UNIQUE NOT NULL | ร้านที่ถือสมาชิก |
| status | text CHECK NOT NULL | trialing pending_payment active past_due expired ended |
| current_price_version_id | uuid FK NULL | ราคาในรอบปัจจุบัน |
| current_period_id | uuid FK NULL | ช่วงสมาชิกที่ใช้ตอนนี้ |
| cancel_at_period_end | boolean NOT NULL | หยุดต่อเมื่อจบรอบ |
| grace_until | timestamptz NULL | ผ่อนผันจาก policy snapshot |
| provider_subscription_ref | text NULL | ตัวอ้างอิง provider |
| trial_consumed_at | timestamptz NULL | ห้าม reset trial จาก recreate link |

ใช้เวลาบน server คำนวณสิทธิ์เสมอ status เป็น cache ที่ worker อัปเดตได้ การตรวจคำขอห้ามอาศัย status active อย่างเดียวเมื่อ end_at ผ่านแล้ว Subscription ไม่รับ user_id เป็นเจ้าของแทนร้าน การลบร้านและ trial abuse ตรวจแยกโดยไม่ใช้ข้อมูลอุปกรณ์ลูกค้า

### 16.4 subscription_periods และ subscription_changes

ประวัติรอบและคำขอเปลี่ยนแพ็กเกจ

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| periods subscription_id | uuid FK NOT NULL | สมาชิกของร้าน |
| periods start_at end_at | timestamptz NOT NULL | ช่วงเริ่มรวม สิ้นสุดไม่รวม end หลัง start |
| periods source invoice_id | text uuid NULL | trial paid complimentary; paid มี invoice |
| periods plan_snapshot price_snapshot | jsonb NOT NULL | สิทธิ์ ราคา สกุล รอบและภาษี ณ เวลานั้น |
| periods invoice_id | uuid FK NULL | UNIQUE ภายในร้านเมื่อเป็น paid |
| changes requested_price_version_id | uuid FK NOT NULL | แพ็กเกจที่จะเปลี่ยน |
| changes effective_at status | timestamptz text | scheduled applied cancelled blocked |

กัน paid periods ที่ซ้อนในร้านโดย exclusion constraint กับ tstzrange และ btree_gist หรือ lock subscription และตรวจช่วงใน transaction ที่บังคับทุก mutation การต่อก่อนหมดอายุใช้ปลาย paid period ล่าสุดรวม future periods คำขอ retry ใช้ invoice id เดิมจึงไม่ต่อซ้ำ

### 16.5 entitlement_grants และ usage_counters

สิทธิ์ชั่วคราวและตัวนับการใช้

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| grants subscription_id | uuid FK NOT NULL | ร้านและสมาชิกที่เพิ่มสิทธิ์ |
| grants key value starts_at ends_at | text jsonb timestamptz | feature หรือ quota ที่ override เฉพาะเวลา |
| grants reason approved_by | text uuid FK | เหตุผลและผู้มีสิทธิ์ให้ grant |
| grants status | text CHECK | active revoked expired |
| counters metric window_key used reserved | text text bigint bigint | UNIQUE ร้าน metric window |
| counters updated_at version | timestamptz integer | ค่าและ version ล่าสุด |

effective entitlement = valid period snapshot กับ grant ที่ยัง active ตาม precedence ที่กำหนด grant ไม่ชนะ organization security suspension Seats ใช้ COUNT active technicians เป็นแหล่งจริง counter เป็น cache; storage ใช้ bytes ready รวม reserved upload; OCR นับงานที่ accepted เข้า worker ไม่เพิ่มอีกจาก retry provider request เดิม

### 16.6 usage_reservations

กันการใช้พร้อมกันเกิน quota

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| metric quantity | text bigint NOT NULL | storage bytes หรือ OCR จำนวน ต้องมากกว่าศูนย์ |
| window_key operation_key | text NOT NULL | UNIQUE ร้าน metric operation |
| status | text CHECK | reserved consumed released expired |
| expires_at asset_id | timestamptz uuid NULL | อายุ reservation และไฟล์ที่เกี่ยวข้อง |

ตรวจ used + reserved + request ใน transaction เมื่อ finalize ไฟล์แล้ว consume ครั้งเดียว failed upload release และ expired reservation จัดเก็บได้ Idempotency ของ operation ป้องกันนับซ้ำ OCR เต็มยังส่งบริการแบบกรอกเองได้

## 17 ตารางการชำระเงินและเอกสารสมาชิก

### 17.1 billing_profiles และ billing_invoices

ผู้ซื้อสมาชิกของแพลตฟอร์มแยกจาก customers ของร้าน

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| profile buyer_name address tax_id branch | text NULL | ข้อมูลออกเอกสารตามสิ่งที่บริษัทใช้จริง |
| invoice subscription_id number | uuid text | number UNIQUE ตามชุดเอกสารที่กำหนด |
| invoice status currency | text char(3) | draft open paid void uncollectible |
| invoice subtotal tax total_minor | bigint NOT NULL | จำนวนไม่ติดลบและสมการยอดรวม |
| invoice buyer_snapshot price_snapshot | jsonb NOT NULL | ชื่อที่อยู่และรายการราคา ณ เวลาออก |
| invoice issued_at due_at | timestamptz NULL | เวลาที่ออกและกำหนดชำระ |
| invoice purpose period_start period_end | text timestamptz | renewal initial upgrade; ช่วงที่ซื้อ |

เอกสาร issued แล้วแก้ราคาและผู้ซื้อโดยตรงไม่ได้ ใช้ void และออกใหม่หรือ adjustment ที่ถูกต้องตามกระบวนการ Payment ของลูกค้าปลายทางร้านไม่อยู่ในตารางนี้ Tax fields ไม่แปลว่าระบบออกใบกำกับภาษีได้ถูกต้องก่อนตรวจรูปแบบและนโยบายบริษัท

### 17.2 invoice_lines และ billing_documents

รายการสินค้าและไฟล์เอกสารการเงิน

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| lines invoice_id description quantity | uuid text numeric | quantity มากกว่าศูนย์ |
| lines unit_minor line_total_minor | bigint NOT NULL | ยอดในหน่วยย่อยของ currency |
| lines plan_price_version_id | uuid FK NULL | อ้างอิงราคากับ snapshot |
| documents invoice_id payment_id refund_id | uuid FK NULL | เป้าหมายตาม document_type |
| documents document_type number | text NOT NULL | invoice receipt adjustment; หมายเลขไม่ซ้ำ |
| documents storage_key status issued_at | text text timestamptz | private; queued ready failed voided |

receipt ออกเมื่อยืนยันรับเงินจริง ไม่ออกจาก proof pending การสร้างไฟล์ล้มเหลวไม่ rollback paid period แต่ retry document generation ได้ UNIQUE source และ document_type ตามนโยบายป้องกันออกซ้ำ Signed URL ตรวจ Owner หรือ Billing role ก่อนทุกครั้ง

### 17.3 payment_attempts และ payments

แยกความพยายามชำระออกจากเงินที่ยืนยันรับจริง

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| attempts invoice_id method | uuid text | manual_transfer หรือ hosted_provider |
| attempts idempotency_key provider_ref | text | key UNIQUE ภายในร้าน invoice |
| attempts status | text CHECK | created pending succeeded failed expired cancelled |
| payments amount_minor currency | bigint char(3) | รับจริง มากกว่าศูนย์ |
| payments status settled_at | text timestamptz | pending verified rejected; verified มีเวลา |
| payments provider reference | text text | UNIQUE provider reference ตามขอบเขต |
| payments verified_by | uuid FK NULL | Billing account สำหรับ manual |

amount กับ currency ต้องตรง invoice หรืออยู่ใน partial payment policy ที่ตั้ง Payment_verified เป็นผลรับเงิน ห้ามสร้างจาก client success screen Provider failure ของ attempt หนึ่งไม่ทำให้ verified payment อีกตัวถูกยกเลิก

### 17.4 payment_proofs และ payment_allocations

หลักฐานโอนและการผูกเงินกับ invoice

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| proofs attempt_id storage_key | uuid text | private evidence ไม่ใช้ service media ที่ช่างอ่านได้ |
| proofs status submitted_by_member_id | text uuid | submitted reviewing accepted rejected |
| proofs rejection_reason reviewed_by | text uuid NULL | เหตุผลและผู้ตรวจ |
| allocations payment_id invoice_id | uuid FK NOT NULL | ต้องเป็นร้านและ currency เดียวกัน |
| allocations amount_minor | bigint NOT NULL | ยอดที่จัดสรรมากกว่าศูนย์ |

ล็อก payment และ invoice ก่อน allocate ตรวจยอดจัดสรรรวมไม่เกินเงิน verified และยอดค้าง invoice เมื่อยอดครบจึง paid และสร้าง periodหนึ่งครั้ง หลักฐานซ้ำไม่แปลว่าเงินรับซ้ำ reference ที่ถูกใช้แล้วต้องแจ้ง conflict

### 17.5 refunds และ approval_requests

คำขอคืนเงินจริงและการอนุมัติคำสั่งสำคัญ

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| refunds payment_id amount_minor | uuid bigint NOT NULL | ยอดคืนที่ขอ |
| refunds status provider_ref | text text NULL | requested approved processing succeeded failed rejected |
| refunds requested_by approved_by | uuid FK | คนละ platform account |
| refunds reason entitlement_action | text | เหตุผลและคำขอผลต่อสิทธิ์ที่แยกอนุมัติ |
| approvals action target_id | text uuid | refund role_change data_delete break_glass |
| approvals payload_hash expires_at | text timestamptz | อนุมัติ payload เฉพาะชุดและหมดอายุ |
| approvals status approver_id | text uuid NULL | pending approved rejected expired consumed |

CHECK requester ไม่เท่ากับ approver และล็อก payment ตรวจผลรวม succeeded + processing + approved ไม่เกิน settled amount คำอนุมัติใช้ครั้งเดียวผูก hash ของ payload ห้ามเปลี่ยนยอดหลัง approval การ retry provider ใช้ external idempotency เดิม Refund ไม่แก้ใบรับเดิมเป็น unpaid

### 17.6 webhook_events และ reconciliation_runs

รับผล gateway แบบซ้ำได้และตรวจความตรงของเงินกับสิทธิ์

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| webhooks provider event_id | text NOT NULL | UNIQUE คู่ provider event id |
| webhooks organization_id | uuid NULL ก่อน map | derive จาก mapping ที่เชื่อถือได้ ไม่รับจาก form |
| webhooks received_at signature_verified_at | timestamptz | รับเมื่อไรและตรวจลายเซ็นเมื่อไร |
| webhooks payload_encrypted payload_hash | text | เก็บส่วนที่จำเป็นตาม retention |
| webhooks status attempts next_attempt_at | text integer timestamptz | received processed ignored failed |
| reconciliation started_at finished_at | timestamptz | รอบตรวจสอบ |
| reconciliation mismatch_count report_key | integer text NULL | รายงาน private ตามสิทธิ์ |

ตรวจ signature จาก raw body และ endpoint secret ตาม provider ก่อน enqueue บันทึก durable แล้วตอบ 2xx การไม่รับหรือ commit ไม่สำเร็จคืน error ให้ retry Event id dedupe รวม unique provider transaction ref อีกชั้น Worker fetch canonical state แทนเชื่อ event เก่ามาเปลี่ยน latest state ข้อมูล secret ไม่อยู่ใน log หรือ Admin UI

## 18 ตารางบริหารแพลตฟอร์มและความเป็นส่วนตัว

### 18.1 platform_accounts และ RBAC

ตัวตนผู้ดูแลแยกจาก membership ร้าน

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| accounts auth_subject email status | text | auth_subject UNIQUE; invited active disabled |
| accounts mfa_enforced last_login_at | boolean timestamptz | บังคับ MFA |
| roles code | text UNIQUE | super_admin platform_admin billing_operator และบทบาทอื่น |
| permissions code | text UNIQUE | เช่น billing.verify support.request access.approve |
| account_roles account_id role_id | uuid FK | UNIQUE คู่ account role |
| role_permissions role_id permission_id | uuid FK | UNIQUE คู่ role permission |

ใช้ permission ต่อ endpoint ไม่ตรวจชื่อ role ใน UI เท่านั้น Disable account revoke sessions พร้อม audit การเพิ่ม Super Admin และ Billing Approver ผ่าน approval_requests ห้ามคนเดียวอนุมัติให้ตนเอง ระบบต้องมีทาง recover ที่ตรวจสอบได้ ไม่ใส่บัญชี root ถาวรในแอป

### 18.2 platform_sessions และ platform_audit_logs

Session ผู้ดูแลและหลักฐานการกระทำข้ามร้าน

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| sessions account_id token_hash | uuid text | token hash UNIQUE |
| sessions expires_at revoked_at step_up_at | timestamptz | อายุและการยืนยันซ้ำ |
| audit actor_account_id organization_id | uuid FK NULL | actor และร้านเป้าหมายเมื่อเกี่ยวข้อง |
| audit permission action target_id | text text uuid | ขอบเขตที่ใช้และสิ่งที่ทำ |
| audit reason before after | text jsonb jsonb | field จำเป็น ปิดบังข้อมูลส่วนบุคคล |
| audit request_id support_grant_id | text uuid NULL | เชื่อม request และการเข้าถึง |

Audit append only Runtime เปลี่ยนหรือลบไม่ได้ การอ่านเนื้อหาภายใต้ support grant บันทึก target และเหตุผล ห้ามเก็บ raw tokens banking secrets หรือข้อมูลลูกค้าทั้งก้อน Admin financial access กับ tenant history access ใช้ grants คนละชุด

### 18.3 support_tickets และ support_messages

การช่วยเหลือร้านโดยมีคำตอบและผู้รับผิดชอบ

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| ticket organization_id opened_by_member_id | uuid FK | ร้านและผู้ขอ |
| ticket subject category priority | text | ปัญหา billing access upload และอื่น ๆ |
| ticket status assigned_account_id | text uuid NULL | open assigned waiting_owner resolved closed |
| messages ticket_id author_type author_id | uuid text uuid | member หรือ platform account ตาม CHECK |
| messages visibility body attachment_key | text text text NULL | owner_visible หรือ internal; attachment private |

Owner เห็นเฉพาะ messages owner_visible และไฟล์ของร้านตน Technician แจ้งปัญหาเทคนิคผ่านช่องทางที่กำหนดโดยไม่เห็น billing ticket การเปลี่ยนสถานะ ticket ไม่เปิดสิทธิ์ข้อมูลลูกค้า

### 18.4 support_access_grants

สิทธิ์เปิดข้อมูลเฉพาะที่ได้รับความยินยอม

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| organization_id ticket_id account_id | uuid FK NOT NULL | ร้าน ticket และผู้รับ grant |
| scope target_type target_id | text text uuid | อ่านเฉพาะงานหรือสถานที่ที่ระบุ |
| owner_consented_by approved_by | uuid FK | Owner ของร้านกับ approver แพลตฟอร์ม |
| starts_at ends_at revoked_at | timestamptz | เวลาเปิดและเพิกถอน |
| status reason incident_id | text text uuid NULL | pending active revoked expired rejected; reason จำเป็น |

อนุมัติให้บัญชีเดียวใช้ไม่ได้ตรวจเพียง ticket สมาชิก platform account ต้อง active และ session step up ยัง valid READ content/media ทุกครั้งตรวจ scope และเวลา Grant read only ไม่ทำให้สร้าง ServiceEvent หรือใช้ role Owner ได้ Emergency scope ต้องมี incident และสองบุคคลตาม approval policy

### 18.5 data_requests และ deletion_tombstones

คำขอ export ปิดร้านและลบข้อมูล

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| requests organization_id type | uuid text | export closure deletion |
| requests requested_by status | uuid text | submitted verified approved queued completed rejected |
| requests scope cooling_until | jsonb timestamptz NULL | ข้อมูลและระยะก่อนดำเนินการ |
| requests export_storage_key expires_at | text timestamptz NULL | private download อายุจำกัด |
| requests financial_hold reason | boolean text NULL | ข้อจำกัดการเก็บข้อมูล |
| tombstones organization_id entity_type id | uuid text uuid | รายการลบหรือ anonymize ที่ต้อง replay |
| tombstones executed_at policy_version | timestamptz uuid | เวลาและนโยบาย |

ไม่ลบ financial documents ที่มีภาระ retention โดย cascade แยก data deletion กับ close organization ระบบ restore replay tombstones ก่อนเปิด API และแจ้งข้อจำกัดการลบใน backup ตาม retention ที่ประกาศ

### 18.6 platform_settings announcements และ incidents

ค่าระบบ ประกาศ และเหตุขัดข้อง

| Field | ชนิดและข้อกำหนด | ความหมาย |
| --- | --- | --- |
| settings key version payload | text integer jsonb | versioned policy พร้อม schema validation |
| settings published_by effective_at | uuid timestamptz | ผู้เผยแพร่และเวลา |
| announcements title body audience | text text jsonb | ข้อความและกลุ่มร้าน |
| announcements status scheduled_at | text timestamptz NULL | draft scheduled published cancelled |
| incidents title severity status | text | investigating identified monitoring resolved |
| incidents impacted_services timeline | jsonb | ส่วนที่ได้รับผลและความคืบหน้า |

เปลี่ยน grace หรือ trial ไม่แก้ snapshot ของช่วงเดิมโดยเงียบ ใช้ approval และ preview affected count เมื่อกระทบหลายร้าน ประกาศและ incident แสดงเฉพาะ metadata ที่ปลอดภัย Tenant รับข้อความตาม audience ไม่มี secret หรือชื่อคนปลายทาง

## 19 การบังคับสิทธิ์และธุรกรรมการเงิน

ลำดับตรวจ API คือ identity → account หรือ membership active → organization security state → role object scope → effective entitlement ที่ใช้เวลา server → quota → version → mutation ทุก mutation รวม upload reservation join approval และ offline completion ต้องตรวจ ห้ามล็อกแค่ปุ่มใน UI

pending_payment ที่ไม่มี period valid เปิดเฉพาะ Owner billing และ support ไม่เปิด business mutations Invoice renewal pending ไม่ทำให้ period active เดิมหยุด Past due grace ใช้กับการต่ออายุล้มเหลวตาม policy ส่วน cancel_at_period_end ที่ Owner เลือกให้ ended เมื่อครบโดยไม่ยืดด้วย grace

| สถานะ | Owner | Technician | รอบดูแลและข้อมูล |
| --- | --- | --- | --- |
| trialing active | ใช้สิทธิ์ตามแพ็กเกจ | งานที่มอบหมายและหน้างาน | บันทึกและวนรอบบริการได้ |
| past_due ภายใน grace | ใช้งานตามสิทธิ์เดิม เห็นเตือนชำระ | ทำงานต่อได้ ไม่เห็นข้อมูลเงิน | แจ้งเตือนรอบดูแลตามปกติ |
| expired หรือ ended | อ่านประวัติ ต่ออายุ ขอ export | อ่านงานตนเองที่เคยมีสิทธิ์; ไม่สร้างบริการใหม่ | คง due และ history ไม่ลบ |
| งานที่เริ่มก่อนหมดอายุ | ดูผลส่งที่เข้าเงื่อนไขได้ | ส่ง draft เดิมภายในช่วงที่ตั้งไว้ | ห้ามเปิดงานใหม่ใช้ช่องทางนี้ |
| organization suspended | ไม่มีสิทธิ์ข้อมูลธุรกิจ ติดต่อทีมได้ | ไม่มีสิทธิ์ข้อมูลธุรกิจ | ข้อมูลคงอยู่ worker ธุรกิจพัก |
| membership suspended removed | ตามสิทธิ์สมาชิกที่ยัง active | บัญชีนั้นเข้าไม่ได้ | ประวัติผู้ทำเดิมยังอยู่ |

การอนุมัติช่างล็อก organization quota row แล้วนับ active technicians ภายใน transaction ใช้ lock order เดียวกับการ activate suspension และ downgrade ทุกครั้ง ไม่ใช้ read count ก่อนเริ่ม transaction

### 19.1 Transaction ยืนยันรับเงิน

• ตรวจ Billing permission step up authentication และ payload ที่ idempotent

• ล็อก subscription invoice และ payment ตามลำดับที่กำหนด

• ตรวจ provider reference amount currency allocation และไม่เคย apply invoice นี้

• บันทึกเงิน verified และ allocation เมื่อยอดครบเปลี่ยน invoice paid

• สร้าง subscription_period snapshot พร้อม start end ที่ไม่ซ้อนและอัปเดต effective entitlement version

• บันทึก audit outbox และ result idempotency แล้ว commit

• สร้างเอกสารและแจ้ง Owner หลัง commit หาก fail retry เป็นคำสั่งเดิม

การต่ออายุสอง invoice ที่ชำระพร้อมกันต้องต่อจากปลาย period ล่าสุดภายใต้ subscription lock หากเป็น duplicate purchase ที่ไม่ควรต่อ ให้สร้าง overpayment review ไม่แปลงทุกยอดเข้าเป็นรอบใหม่อัตโนมัติ

### 19.2 ความปลอดภัย webhook และการเข้าถึง admin

Provider adapter แปลงสถานะมา domain states อย่างชัดเจน retry ไม่เปลี่ยนราคา invoice snapshot และ failure event เก่าไม่ย้อนเงิน verified Admin API ใช้ role แยกจาก tenant APIและคำสั่งที่กำหนด scope ไม่เปิด SQL console สาธารณะ RLS ของ tenant มี default deny; admin role ให้สิทธิ์เฉพาะ schema billing platform และ view metadata ที่ปิดบังข้อมูล

หาก Support ต้องอ่าน business schema ให้ผ่าน query gateway หรือ database function ที่ตรวจ grant อย่างเข้ม ไม่ใช้ runtime role แบบเจ้าของตารางทุก schema Functions ที่เพิ่มใช้ SECURITY DEFINER ต้องจำกัด search_path revoke PUBLIC execution และตรวจ grant ทุกครั้ง รวม media output

## 20 API สำหรับสมาชิกและแพลตฟอร์ม

| กลุ่ม endpoint | ผู้มีสิทธิ์ | ผลที่ต้องยืนยัน |
| --- | --- | --- |
| GET /v1/billing/subscription plans usage | Owner; usage ที่ปลอดภัยสำหรับช่าง | รอบ ราคา สิทธิ์ และข้อจำกัดที่มีผล |
| POST /v1/billing/checkout proof | Owner | invoice attempt pending ไม่ active จาก UI |
| POST /v1/billing/cancel-renewal change | Owner | วันมีผล version และ snapshot |
| GET /v1/billing/invoices documents | Owner | เอกสารร้านตน private URL |
| POST /v1/webhooks/{provider} | verified provider | durable event dedupe signature |
| GET /platform/v1/organizations detail usage | Platform permissions | metadata tenant เป้าหมายและข้อมูล masked |
| POST /platform/v1/plans publish | Plan permission | immutable version และ audit |
| POST /platform/v1/payments verify reject | Billing Operator | transaction ตามหัวข้อ 19 |
| POST /platform/v1/refunds request approve | Billing permissions | dual control ยอดไม่เกินรับจริง |
| POST /platform/v1/organizations suspend restore | Access management | เหตุผล version step up audit |
| POST /platform/v1/entitlement-grants | Entitlement permission | grant วันสิ้นสุด ไม่แก้ paid amount |
| POST /platform/v1/support access-request | Support | scope consent approver expiry |
| POST /platform/v1/data-requests approve | Data permission | scopeและ retention ไม่มีลบทันที |
| GET /platform/v1/health reconciliation audit | Ops Billing Auditor ตามโมดูล | ไม่มีเนื้อหาลูกค้าหรือ secret |
| POST /platform/v1/staff roles settings publish | Admin permission | approval เมื่อสิทธิ์สูงหรือกระทบหลายร้าน |

| Error code | HTTP | ผลต่อแอป |
| --- | --- | --- |
| SUBSCRIPTION_EXPIRED | 403 | Owner ต่ออายุ; ช่างติดต่อ Owner รักษา draft |
| PLAN_LIMIT_REACHED | 409 | บอก quota และทางออกไม่ลบข้อมูล |
| PAYMENT_PENDING_VERIFICATION | 409 | รอตรวจไม่เปิด paid entitlement |
| PAYMENT_REFERENCE_USED | 409 | หยุดเงินซ้ำให้ตรวจรายการเดิม |
| APPROVAL_REQUIRED | 409 | แสดงผู้อนุมัติและคำขอ pending |
| SUPPORT_GRANT_EXPIRED | 403 | หยุดอ่านทันที ไม่ refresh URL |
| ORGANIZATION_SUSPENDED | 403 | สิทธิ์ทางการเงินไม่ bypass security |
| REFUND_EXCEEDS_AVAILABLE | 422 | บอกยอดคืนที่เหลือโดยไม่ส่งให้ gateway |

## 21 การทดสอบและการส่งต่อทั้งระบบ

ใช้ integration tests สำหรับ paid period quotaและ concurrent requests ใช้ sandbox provider หรือ manual test ledger ที่ชัดเจน ห้ามใช้ production payment เพื่อทดลอง UI การทดสอบ refund grant quota และ webhook เป็นงานระบบจริงหลัง implementation ไม่ถือว่าผ่านจากต้นแบบ

| กรณี | ผลที่ต้องผ่าน |
| --- | --- |
| proof pending redirect success | ไม่ active จนเงิน verified |
| duplicate webhook และ concurrent verify | payment period invoice outbox ไม่ซ้ำ |
| out of order failure success | latest settled stateไม่ย้อนกลับ |
| partial underpayment overpayment | ยอดจัดสรรถูกต้อง ส่งreviewไม่ให้สิทธิ์เพิ่มเอง |
| refund approved parallel | ผลรวมไม่เกินยอดรับและคนละ approver |
| two join approvals last seat | สำเร็จเพียงคำขอที่ยังมี seat |
| period crosses timezone month end | เวลา entitlement รอบรายเดือนและรายปีถูกต้อง |
| expiry while offline in progress | ส่งได้เฉพาะข้อยกเว้น ไม่เริ่มงานใหม่ |
| quota storage OCR full | กรอกบริการต่อได้ ภาพเก่าไม่ถูกลบ |
| Support grant revoked expires | data media exportถูกปฏิเสธ |
| disable platform account | sessionและคำสั่งที่ค้างตรวจสิทธิ์ใหม่ |
| closure deletion restore | retentionและ tombstonesยังมีผล |
| retry verify after restore | unique ref และ idempotencyไม่ต่อรอบซ้ำ |

งานส่งต่อคือ migration สำหรับสาม schema API OpenAPI permission matrix full transaction tests hosted provider adapter หรือ manual verification workflow report reconciliation monitoring และ runbook backup restore deploy rollback เอกสารนี้ยังไม่ใช่ DDL ที่รันแล้วหรือ API server ที่เปิดใช้

### 21.1 แหล่งอ้างอิงสำหรับ provider adapter

เอกสาร Stripe ใช้เป็นตัวอย่างพฤติกรรม webhook ไม่ถือว่าเลือก Stripe เป็นผู้รับชำระแล้ว Provider ที่เลือกจริงต้องตรวจรูปแบบ signature event ordering retry และสถานะเงินของตนเอง

https://docs.stripe.com/webhooks

https://docs.stripe.com/billing/subscriptions/webhooks
