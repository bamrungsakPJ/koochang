# ServiceFlow
## Product Requirements & Initial Build Brief

### 1. Product Vision

สร้าง SaaS สำหรับธุรกิจประเภท:

**Dealer + Installation + After-sales Service**

ตัวอย่างธุรกิจเป้าหมาย:

- ร้านแอร์
- เครื่องกรองน้ำ
- CCTV
- Solar
- ปั๊มน้ำ
- Compressor
- เครื่องทำน้ำแข็ง
- เครื่องจักร SME
- เครื่องชั่ง
- ประตูอัตโนมัติ
- อุปกรณ์ครัวเชิงพาณิชย์
- เครื่องซักอุตสาหกรรม
- ธุรกิจอื่นที่มี workflow:

**ขาย → ติดตั้ง → Warranty → Service/PM → Repair → Parts → Service ซ้ำ**

ระบบต้องเป็น Generic Core ที่สามารถใช้ร่วมกันหลายธุรกิจได้ แต่ในอนาคตสามารถทำ Vertical-specific configuration ได้

---

# 2. Product Philosophy

หลักสำคัญที่สุดของระบบคือ:

> ผู้ใช้ต้องกรอกข้อมูลให้น้อยที่สุด

ระบบต้องหลีกเลี่ยง traditional form-based UX โดยเฉพาะสำหรับช่างและลูกค้า

Interaction หลักควรเป็น:

**Tap → Photo → Voice → Location → Done**

Keyboard/Text Input เป็นทางเลือกสุดท้าย

หลักการ:

> ข้อมูลที่ระบบรู้แล้ว ห้ามถามซ้ำ

> ข้อมูลที่คำนวณได้ ห้ามให้คนกรอก

> ข้อมูลที่อ่านจากรูปได้ ควรให้ระบบอ่าน

> ข้อมูลที่เกิดจาก action ควรบันทึกอัตโนมัติ

> ข้อมูลที่ยังไม่จำเป็น ไม่ควรบังคับกรอก

ระบบต้องอนุญาตให้ข้อมูลบาง field ไม่สมบูรณ์ได้

**Incomplete Data > User ไม่ยอมใช้ระบบ**

---

# 3. Primary Users

ระบบมีผู้ใช้หลัก 4 กลุ่ม

## 3.1 Owner / Admin

เจ้าของกิจการหรือผู้ดูแลงาน

ต้องสามารถ:

- ดูงานทั้งหมด
- ดูงานค้าง
- ดูช่าง
- มอบหมายงาน
- ดู Installed Assets
- ดู Warranty
- ดู PM / Service Due
- ดูประวัติการซ่อม
- ดูงานรออะไหล่
- ดูโอกาสรายได้จากลูกค้าเก่า

---

## 3.2 Technician

ช่างภาคสนาม

เป้าหมาย UX:

**ช่างไม่ควรต้องเรียนระบบ**

ควรสามารถทำงานหลักผ่านมือถือ/LINE ได้

ต้องสามารถ:

- รับงาน
- ดูสถานที่
- ดูข้อมูลเครื่อง
- กดถึงหน้างาน
- ดูประวัติ
- ถ่ายรูป
- บอกสิ่งที่ทำผ่านตัวเลือกหรือ Voice
- ระบุว่าต้องใช้อะไหล่
- ปิดงาน

---

## 3.3 Customer

ลูกค้าปลายทาง

ไม่ควรต้องติดตั้ง Application

ควรใช้ผ่าน LINE / Web link / QR

ต้องสามารถ:

- ดูอุปกรณ์ของตัวเอง
- แจ้งปัญหา
- เลือกอุปกรณ์
- เลือกอาการ
- ส่งรูป/วิดีโอ
- ส่ง location
- ขอรับบริการ
- รับสถานะงาน
- รับแจ้งเตือน PM
- นัดหมายบริการ

---

## 3.4 Dispatcher / Service Admin

สำหรับธุรกิจที่มีคนรับแจ้งงาน

ต้องสามารถ:

- รับงาน
- ค้นลูกค้า
- ค้น Asset
- สร้าง Job
- มอบหมายช่าง
- ดูสถานะงานทั้งหมด

---

# 4. Core Domain Model

พยายามรักษา Core Model ให้เรียบง่าย

Core entities หลัก:

**Customer**

↓

**Site**

↓

**Asset**

↓

**Service Job**

↓

**Technician**

Supporting entities:

- Asset Model
- Asset Category
- Warranty
- Service Rule
- Job Event
- Job Photo
- Part Used
- Service History
- LINE Identity
- QR Identity

อย่าสร้าง Accounting/ERP domain ใน Core

---

# 5. Customer

เก็บข้อมูลเท่าที่จำเป็น

Minimum fields:

- customer_id
- display_name
- phone (optional)
- LINE identity (optional)
- notes (optional)

ห้ามบังคับ:

- email
- gender
- birth date
- national ID
- full structured address

เว้นแต่ future vertical ต้องใช้จริง

Customer สามารถมีหลาย Site

Customer สามารถมีหลาย Asset

---

# 6. Site / Service Location

Site คือสถานที่ติดตั้งอุปกรณ์

ตัวอย่าง:

- บ้าน
- ร้าน
- โรงงาน
- สาขา
- อาคาร

ข้อมูล:

- site_id
- customer_id
- display_name
- location coordinates
- address text (optional)
- notes

ระบบควรสนับสนุน:

**Send Location**

แทนการบังคับกรอกที่อยู่

---

# 7. Asset — หัวใจของระบบ

Asset คืออุปกรณ์ที่ธุรกิจเคยขาย/ติดตั้ง/ดูแล

ตัวอย่าง:

Air Conditioner

Machine

Water Purifier

CCTV

Pump

Compressor

Asset minimum data:

- asset_id
- customer_id
- site_id
- category
- brand
- model
- serial_number
- installed_date
- warranty_start
- warranty_end
- status
- primary photo
- QR code

แต่ทุก field ยกเว้น asset_id ไม่จำเป็นต้อง Required ทั้งหมด

Asset สามารถถูกสร้างได้แม้มีข้อมูลเพียง:

Customer + Photo

แล้วค่อย enrich ภายหลัง

---

# 8. Asset Creation — Zero Form Principle

เป้าหมาย:

สร้าง Asset ใหม่ภายในประมาณ 10–20 วินาที

Preferred Flow:

Technician:

**Add Installed Asset**

↓

เลือก Customer หรือสร้างใหม่แบบ Quick Add

↓

📷 Take Nameplate Photo

↓

ระบบพยายาม extract:

- Brand
- Model
- Serial

↓

แสดง:

Daikin  
FTKF18WV2S  
SN: XXXXX

[Correct] [Edit]

↓

📍 Current Site

↓

[Installation Complete]

ระบบบันทึกอัตโนมัติ:

- installed date = now
- technician = current technician
- company = current tenant
- asset status = active
- warranty ตาม rule
- next service ตาม Service Rule

---

# 9. OCR / AI Requirement

ระบบควรออกแบบ architecture รองรับ AI/Vision แต่ไม่ควร dependency กับ AI ตั้งแต่แรก

Use cases:

## Nameplate Recognition

Input:

Photo

Expected structured output:

- brand
- model
- serial number

ต้องมี Human Confirmation

AI ห้าม overwrite ข้อมูลสำคัญโดยไม่มี confirmation

หากอ่านไม่ได้:

Asset ยังสามารถสร้างได้

serial_number = null

ห้าม block workflow

---

# 10. QR per Asset

ทุก Asset สามารถมี QR Code

QR ใช้เป็น Asset Identity

ตัวอย่าง sticker:

SERVICE BY ABC

Scan for Service

[QR]

QR ไม่ควร expose database ID โดยตรง

ใช้ public random token

ตัวอย่าง:

/a/{public_token}

เมื่อ scan:

ระบบรู้ Asset ทันที

ดังนั้นลูกค้าไม่ต้องกรอก:

- ชื่อ
- เบอร์
- รุ่น
- Serial
- วันที่ซื้อ

---

# 11. Customer Service Request

Preferred Flow:

Customer scan QR

↓

ระบบแสดง:

Air Conditioner — Bedroom

Daikin FTKF18

↓

ถาม:

**What is the problem?**

ตัวเลือกขึ้นกับ Asset Category เช่น:

- Not Cooling
- Water Leak
- Noise
- Cannot Start
- Other

↓

optional:

📷 Photo

🎥 Video

🎙 Voice / Text

↓

[Request Service]

จบ

เป้าหมาย:

ลูกค้าสามารถแจ้งปัญหาทั่วไปได้ภายในประมาณ 10–20 วินาที

---

# 12. Job Creation

Job สามารถเกิดจาก:

1. Customer QR
2. Customer LINE
3. Admin
4. Technician
5. Scheduled PM
6. Future API

Job minimum data:

- job_id
- asset_id
- customer_id
- site_id
- issue_type
- status
- created_at

ถ้ามี Asset อยู่แล้ว ระบบต้อง populate Customer/Site/Warranty อัตโนมัติ

---

# 13. Job Status

อย่าทำ workflow ซับซ้อนเกินไป

Initial statuses:

NEW

ASSIGNED

ACCEPTED

ON_THE_WAY

ON_SITE

IN_PROGRESS

WAITING_PART

NEED_RETURN_VISIT

COMPLETED

CANCELLED

ทุก status change สร้าง Job Event อัตโนมัติ

---

# 14. Technician Workflow

Technician ได้ LINE:

**New Service Job**

Customer: Somchai

Asset: Daikin FTKF18

Problem: Not Cooling

Warranty: Active

[Accept Job]

↓

Technician กด Accept

ระบบบันทึก:

accepted_at

technician_id

status = ACCEPTED

เมื่อเดินทาง:

[On The Way]

ถึงหน้างาน:

[Arrived]

ระบบบันทึก timestamp อัตโนมัติ

---

# 15. Technician On-site UX

ห้ามมี Form ยาว

แสดง:

Asset

Issue

Warranty

Previous Service

แล้วให้ action:

[Maintenance]

[Repair]

[Replace Part]

[Need Part]

[Need Return Visit]

---

# 16. Completing Job

Preferred flow:

Technician:

เลือก:

Repair Completed

↓

Optional:

📷 Before Photo

📷 After Photo

↓

ถาม:

**What was done?**

ตัวเลือก:

- Clean / PM
- Repair
- Replace Part
- Adjustment
- Other

สามารถใช้ Voice:

“เปลี่ยน capacitor 35 microfarad หนึ่งตัว”

ระบบสามารถแปลงเป็น structured suggestion:

Part: Capacitor

Spec: 35uF

Qty: 1

Technician:

[Correct]

↓

[Complete Job]

ระบบ:

- completed_at
- status = COMPLETED
- create service history
- calculate next service date
- update asset history

---

# 17. Waiting Part

ถ้าช่างกด:

**Need Part**

ระบบถามให้น้อยที่สุด:

Part name / Voice / Photo

แล้ว:

status = WAITING_PART

Owner dashboard ต้องเห็น:

**Jobs Waiting for Parts**

ใน MVP ยังไม่ต้องทำ Full Inventory

Part Used เป็นเพียง service record

---

# 18. Service History

Asset ทุกตัวต้องมี Timeline

ตัวอย่าง:

12 Mar 2026
Installed
Technician: A

15 Sep 2026
PM
Cleaned

4 Jan 2027
Repair
Replaced Capacitor 35uF

Timeline ถูกสร้างจาก Job Events

ไม่ควรให้ user เขียน Service History เอง

---

# 19. Warranty

Warranty ต้อง configurable

เช่น:

Asset Category / Brand / Model

Default Warranty:

12 months

24 months

36 months

etc.

เมื่อติดตั้ง:

warranty_start = installed_date

warranty_end calculated automatically

Job ต้องแสดงทันที:

Warranty Active

Warranty Expired

Unknown

---

# 20. Preventive Maintenance / Recurring Service

Service Rule สามารถกำหนดตาม:

- Asset Category
- Brand
- Model
- Customer
- Asset

ตัวอย่าง:

Air Conditioner

Service every 6 months

Water Purifier

Filter replacement every 12 months

Machine

PM every 3 months

เมื่อปิด Job:

ระบบคำนวณ next_service_date

---

# 21. Service Due Engine

ระบบต้องสามารถ query:

Due Today

Due This Week

Due This Month

Overdue

ตัวอย่าง Dashboard:

Service Due This Month

312 Assets

Estimated Service Revenue:

187,200 THB

Booked:

68,400 THB

Not Contacted:

118,800 THB

---

# 22. Revenue Opportunity

นี่เป็นหนึ่งใน Core Value Propositions

อย่าแสดง Dashboard เพียง:

Customers

Jobs

Assets

แต่เน้น:

**Revenue Opportunities**

ตัวอย่าง:

Assets Due for Service: 312

Potential Revenue: 187,200

Booked: 68,400

Not Contacted: 118,800

Recovered Revenue This Month: 42,600

Estimated revenue อาจมาจาก Default Service Price ตาม Asset Category/Service Rule

---

# 23. LINE Integration

LINE OA เป็น Primary Interaction Channel สำหรับประเทศไทย

ระบบต้องออกแบบ LINE abstraction ตั้งแต่ต้น

LINE ใช้สำหรับ:

Customer:

- service request
- PM reminder
- job status
- appointment link

Technician:

- new job
- accept job
- job actions
- pending job reminder

Owner:

- new service request
- overdue jobs
- waiting parts
- service due
- daily summary

ไม่จำเป็นต้อง implement ทุกอย่างใน Phase 1 แต่ architecture ต้องรองรับ

---

# 24. LINE Identity

ระบบต้องสามารถ map:

LINE User ID

↓

Customer / Technician

ห้ามใช้ LINE display name เป็น primary identity

หนึ่ง Customer อาจมี:

phone

LINE identity

QR-linked assets

---

# 25. Progressive Data Collection

ระบบต้องไม่ require database migration ก่อนใช้งาน

หลักการ:

**Zero Migration Required**

ร้านสามารถสมัครวันนี้และเริ่ม Job แรกได้ทันที

ข้อมูลจะสะสมจาก operation จริง

Customer เก่าเข้ามา:

สร้าง Customer

↓

สร้าง Asset

↓

หลังจากนั้นระบบจำ

Historical Import เป็น optional

---

# 26. Import

Future/Phase 2:

รองรับ:

CSV

Excel

ข้อมูลอาจมีเพียง:

Customer

Phone

Product

Installation Date

ไม่ควร reject record เพราะไม่มี Model/Serial

Partial import ต้องรองรับ

---

# 27. Search

Search ต้องเร็วและ forgiving

Global Search สามารถค้นด้วย:

- Customer name
- Phone
- Serial
- Model
- Asset ID
- QR
- Site
- Job ID

Mobile friendly

---

# 28. Dashboard

Owner Dashboard ต้องตอบคำถาม:

**วันนี้มีอะไรต้องจัดการ?**

ไม่ใช่ dashboard ที่เต็มไปด้วย graph

Priority sections:

### Action Required

New Jobs

Unassigned Jobs

Waiting Parts

Return Visits

Overdue Jobs

### Service Opportunity

Due This Week

Due This Month

Potential Revenue

### Operations

Jobs Today

Completed Today

Technicians Working

---

# 29. Multi-Tenant SaaS

ระบบต้องเป็น Multi-Tenant ตั้งแต่ต้น

Tenant = Business / Dealer / Service Company

ข้อมูลทุก business ต้อง isolated

Core tables ทุกตัวต้องสัมพันธ์กับ tenant_id

ต้องออกแบบ authorization ป้องกัน cross-tenant access อย่างจริงจัง

---

# 30. Roles

Initial roles:

OWNER

ADMIN

DISPATCHER

TECHNICIAN

ไม่ต้องทำ permission matrix ซับซ้อนใน MVP

แต่ architecture ต้องขยายได้

---

# 31. Audit / Event Model

สำคัญมาก:

ทุก Job action ควรสร้าง Event

ตัวอย่าง:

JOB_CREATED

TECHNICIAN_ASSIGNED

JOB_ACCEPTED

TECHNICIAN_ON_SITE

PART_REQUIRED

JOB_COMPLETED

CUSTOMER_NOTIFIED

PM_REMINDER_SENT

Event เก็บ:

event_type

timestamp

actor

metadata

Event Model จะใช้สร้าง:

Timeline

Audit

Analytics

Notification

โดยไม่ต้อง duplicate logic

---

# 32. Notifications

ออกแบบ Notification Service แยกจาก business logic

Channel ในอนาคต:

LINE

Email

SMS

Push

แต่ Phase แรกเน้น LINE

Business event ไม่ควร call LINE API โดยตรง

ควรเป็น:

Business Event

↓

Notification Queue

↓

Channel Adapter

↓

LINE

เพื่อรองรับ retry / failure / future channels

---

# 33. Background Jobs

ต้องรองรับ scheduled/background jobs เช่น:

- PM due calculation
- LINE reminders
- overdue job detection
- daily summary
- warranty expiration
- notification retry

---

# 34. Suggested Technical Direction

Developer stack preference:

Node.js

SQL Server

LINE Messaging API

Web frontend

เลือก framework ตามความเหมาะสม แต่ควรรักษา architecture ให้ developer คนเดียวดูแลได้

หลีกเลี่ยง microservices ใน MVP

แนะนำ:

**Modular Monolith**

modules เช่น:

auth

tenant

customer

site

asset

job

technician

service-rule

notification

line

reporting

AI/OCR เป็น adapter แยก

---

# 35. API Design

Backend ต้อง API-first

เพื่อให้อนาคตสามารถมี:

Web Admin

LINE

Mobile App

External Integration

ใช้ backend ชุดเดียวกัน

อย่าผูก business logic กับ UI

---

# 36. Data Integrity

Soft Delete สำหรับ business data สำคัญ

Asset / Customer / Job ไม่ควร hard delete ง่าย ๆ

ใช้ status / archived_at / deleted_at

Job history ต้องรักษาไว้

---

# 37. Security

Minimum requirements:

- secure authentication
- tenant isolation
- role authorization
- audit events
- signed/public random QR token
- rate limiting public endpoints
- secure file upload
- validate MIME/file size
- secrets ผ่าน environment variables
- ห้าม expose internal IDs โดยไม่จำเป็น

---

# 38. Media Storage

Photos/videos ไม่ควรเก็บ binary ใน SQL Server

Database เก็บ metadata/reference

ใช้ Object Storage abstraction

เช่น S3-compatible storage

เพื่อเปลี่ยน provider ได้ในอนาคต

---

# 39. AI Architecture

AI ไม่ใช่ requirement สำหรับ Core System

สร้าง interface เช่น:

AssetRecognitionService

VoiceExtractionService

implementations:

Manual

AI Provider

เพื่อสามารถเปิด/ปิด AI ได้

ระบบต้องยังใช้งานได้ถ้า AI Provider ล่ม

---

# 40. UX Performance Targets

เป้าหมายเชิง Product:

### Customer

แจ้งปัญหาปกติ:

<= 3 actions หลัง scan QR

### Technician

รับงาน:

1 tap

ถึงหน้างาน:

1 tap

ปิดงานง่าย:

<= 3 actions + optional photo

### Asset Installation

ประมาณ:

Photo + Confirm + Complete

### Admin

สร้าง Job จาก Customer เดิม:

<= 30 seconds

---

# 41. MVP Scope

Version 0.1 ต้องมีเพียง:

## Authentication / Tenant

- Business signup
- Login
- Roles

## Customer

- Quick create
- Search
- Customer detail

## Site

- Basic site
- Location

## Asset

- Quick create
- Category
- Brand/model/serial optional
- Photo
- QR
- Warranty
- Asset history

## Job

- Create
- Assign technician
- Status workflow
- Technician actions
- Complete
- Waiting part
- Return visit

## Technician

- Technician list
- Assigned jobs
- Mobile-first job view

## Service Rule

- Service interval
- Next service date

## Dashboard

- action required
- jobs today
- waiting parts
- service due

## LINE

Phase 0.1 อย่างน้อย:

- Technician job notification
- Owner new-job notification

Customer LINE flow สามารถเป็น 0.2 ได้ถ้าทำให้ MVP ใหญ่เกินไป

---

# 42. Explicit Non-Goals

ห้าม implement ใน MVP:

- Accounting
- General CRM
- POS
- Payroll
- HR
- Full Inventory
- Purchasing
- Sales Pipeline
- Marketing Automation
- Complex Appointment System
- Route Optimization
- Full ERP
- Native Mobile App

ห้ามเพิ่ม feature เหล่านี้โดยไม่ได้รับ requirement เพิ่มเติม

---

# 43. MVP Success Criterion

ระบบ MVP ถือว่าใช้งานได้เมื่อสามารถทำ flow นี้ครบ:

Business สมัคร

↓

เพิ่ม Technician

↓

สร้าง Customer แบบ Quick Add

↓

สร้าง Asset โดยกรอกข้อมูลขั้นต่ำ

↓

สร้าง Service Job

↓

Assign Technician

↓

Technician ได้รับงาน

↓

Technician รับงาน

↓

ถึงหน้างาน

↓

ถ่ายรูป/เลือกผลการทำงาน

↓

Complete Job

↓

Asset มี Service History อัตโนมัติ

↓

ระบบคำนวณ Next Service

↓

Owner เห็น Asset ที่กำลังจะ Due

โดยไม่มีขั้นตอนไหนต้องกรอก Form ยาว

---

# 44. UX Rule — Mandatory

ก่อนเพิ่ม Input Field ใด ๆ ให้ถาม:

1. ระบบรู้อยู่แล้วหรือไม่?
2. คำนวณได้หรือไม่?
3. อ่านจากรูปได้หรือไม่?
4. ดึงจาก context ได้หรือไม่?
5. ตั้ง default ได้หรือไม่?
6. ถามทีหลังได้หรือไม่?
7. ถ้าไม่มีข้อมูลนี้ workflow ยังทำต่อได้หรือไม่?

ถ้าคำตอบข้อใดข้อหนึ่งคือ Yes:

**อย่าบังคับกรอก**

---

# 45. Product North Star

ระบบนี้ไม่ควรกลายเป็น:

**Software ที่พนักงานต้องทำงานเพิ่มเพื่อป้อนข้อมูล**

แต่ต้องเป็น:

> **Software ที่สร้างข้อมูลจากงานที่พนักงานทำอยู่แล้ว**

Technician:

**Tap → Photo → Voice → Done**

Customer:

**Scan → Select → Done**

Owner:

**See → Assign → Follow Up**

System:

**Remember → Calculate → Schedule → Notify**

---

# 46. Development Approach

อย่าเริ่ม coding ทุก module พร้อมกัน

ให้เริ่มจาก Vertical Slice แรก:

### Slice 1

Tenant

Customer

Asset

Job

Technician

Job Event

ทำ flow:

**Customer → Asset → Job → Technician → Complete**

ให้ใช้งานได้ end-to-end ก่อน

### Slice 2

Warranty

Service Rule

Next Service

Dashboard

### Slice 3

LINE integration

### Slice 4

QR customer service request

### Slice 5

Photo/OCR/Voice assistance

AI ต้องมาหลัง Core Workflow ใช้งานได้แล้ว

---

# 47. Instructions for Claude Code

ก่อนเขียน implementation จำนวนมาก:

1. วิเคราะห์ requirement ทั้งหมด
2. เสนอ system architecture
3. เสนอ module boundaries
4. เสนอ database schema
5. เสนอ API structure
6. เสนอ repository/project structure
7. เสนอ authentication/authorization strategy
8. เสนอ LINE integration architecture
9. ระบุ assumptions
10. ระบุสิ่งที่ควร defer ออกจาก MVP

จากนั้นสร้าง implementation plan เป็น milestone

**อย่าเริ่มสร้างทุก feature ทันที**

ให้เริ่มจาก Vertical Slice:

**Tenant → Customer → Asset → Job → Technician → Complete Job → Service History**

เมื่อ Slice นี้ทำงานและ test ผ่านแล้วจึงขยาย module ต่อไป

ทุกครั้งที่จะเพิ่ม field หรือขั้นตอนใน UI ต้องตรวจสอบกับ Zero-Form Principle ก่อน

ห้ามเพิ่ม ERP/Accounting/POS/CRM feature นอก scope โดยไม่ได้รับ requirement เพิ่มเติม

---

# 48. Core Product Statement

หากต้องใช้ประโยคเดียวเพื่ออธิบายระบบ:

> **ServiceFlow คือระบบจัดการบริการหลังการขายสำหรับธุรกิจที่ขายและติดตั้งอุปกรณ์ ช่วยจำว่าเครื่องอะไรอยู่ที่ลูกค้าคนไหน รับแจ้งงาน ส่งช่าง เก็บประวัติ Warranty และเรียกลูกค้ากลับมา Service โดยช่างและลูกค้าแทบไม่ต้องกรอกข้อมูล**

Product principle:

> **Tap. Photo. Voice. Done.**