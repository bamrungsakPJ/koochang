# ใบแจ้งหนี้ / ใบเสร็จรับเงิน-ใบกำกับภาษี / ใบลดหนี้ อัตโนมัติผ่าน ITISME

สถานะ (2026-10-09): **โค้ดเสร็จ ทดสอบอัตโนมัติผ่าน ยังไม่ได้เชื่อม SQL Server จริง** — รอผู้ใช้สร้าง ITISME_TEST + login แล้วรัน `infra/itisme/02_koochang_objects.sql`

## สิ่งที่ตัดสินใจแล้ว (ผู้ใช้ 2026-10-09)

- เลขเอกสารต้องต่อเนื่องกับระบบเดิม จึงออกในฐาน **ITISME** (SQL Server บน server2) เล่มเดียวกับโปรแกรมเดิม
- `IV` = ใบแจ้งหนี้, `R` = **ใบเสร็จรับเงิน/ใบกำกับภาษี** (ฟอร์มเดิม "Receipt / Tax Invoice"), `CN` = ใบลดหนี้ (ใหม่)
- PDF คู่ช่างสร้างเอง ตามฟอร์มเดิม (สแกน CCF27052568.pdf)
- **ราคาแพ็กเกจรวม VAT แล้ว** — ถอด VAT แบบระบบเดิม: Subtotal = round(ยอด × 100/107, 2), Vat = ยอด − Subtotal; บรรทัดรายการแสดงราคารวม VAT
- `EmployeeID = 'KOOCHANG'`, `Invoice.PaymentType = '1'`, `ShowInPayment` = default 1, `PaymentCond = '0'`
- ผู้ใช้จะแก้โปรแกรมเดิมให้รองรับใบลดหนี้และเรียก `sp_NextDocNo` ทีหลัง

## ข้อเท็จจริงของ ITISME (อ่านโครงสร้าง 2026-10-09)

- `Invoice` (PK DocNo), `InvoiceDetail` (PK DocNo+Seq), `Receipt` (PK DocNo); ผูกกันด้วย `Invoice.ReceiptNo` ↔ `Receipt.InvoiceNo`; collation `Thai_CI_AS`
- เลข: `IV`/`R` + ปี พ.ศ. 2 หลัก + เดือน + ลำดับ 4 หลัก เริ่มใหม่ทุกเดือน; ลูกค้า `C` + 7 หลัก; HQ '1' + BranchNo '0000' = สำนักงานใหญ่
- เดิม **ไม่มีตัวนับ/sequence/procedure ออกเลข** (โปรแกรมเดิมคิดเลขเอง) — `sp_NextDocNo` ใหม่ล็อกช่วงเลขของเดือนจนจบ transaction
- `sp_GetUnpaidInvoicesForNotification` เตือน IV ที่ไม่มี R → คู่ช่างออก IV + R พร้อมกันเสมอ

## การทำงาน

1. มีการชำระเงิน (`billing.payments` insert ทุกช่องทาง) → trigger สร้างแถวใน `billing.tax_documents` (kind `receipt`, Ref = เลขใบแจ้งชำระคู่ช่าง เช่น `INV-2610-000002`, วันที่ = วันรับเงินตามเวลาไทย, ผู้ซื้อ = snapshot ข้อมูลออกใบเสร็จของร้าน หรือชื่อร้าน)
2. คืนเงินสำเร็จ (`billing.refunds.status → succeeded`) → แถว kind `credit_note` (Ref `RF` + 18 hex ของ refund id) รอจนใบเสร็จของ payment นั้นออกแล้ว
3. worker (`runTaxDocuments`) อ่านการตั้งค่า ITISME จากคอนโซล ถ้าปิดอยู่จะไม่หยิบงาน; ถ้าเปิด เรียก `sp_KC_IssueReceipt` / `sp_KC_IssueCreditNote` และเก็บเลข/ยอด/ข้อมูลบริษัท (`sp_KC_Company`) กลับมา
4. ล้มเหลวชั่วคราว (ต่อไม่ได้) → ลองใหม่ถอยเวลา 1, 2, 4 … นาที สูงสุด 1 ชม. ครบ 10 ครั้งเป็น `failed`; ITISME ปฏิเสธ (THROW 51010–51099) → `failed` ทันที; คอนโซลกด "ส่งใหม่" หรือ "ข้าม" (ออกเองในโปรแกรมเดิม) ได้
5. Ref เดิมส่งซ้ำได้เลขเดิม (procedure ตรวจ `Ref` + `EmployeeID='KOOCHANG'`) — retry หลังคำตอบหายไม่ออกซ้ำ
6. PDF วาดจากแถวที่เก็บไว้ (ไม่ต้องต่อ ITISME): ร้านได้ "ต้นฉบับ" ผ่านลิงก์ลงลายเซ็นอายุ 5 นาที (`/v1/documents/<token>`), คอนโซลได้ "สำเนา" (บันทึก audit ทุกครั้ง)

## ส่วนที่เพิ่ม

| ส่วน | ไฟล์ |
|---|---|
| ITISME objects | `infra/itisme/02_koochang_objects.sql` (รันด้วย `sqlcmd -v DB=ITISME_TEST`) |
| ตรวจโครงสร้าง (อ่านอย่างเดียว) | `infra/itisme/00_inspect.sql` |
| Migration | `database/migrations/034_tax_documents.sql` — `billing.buyer_profiles`, `billing.tax_documents`, triggers, `auth.save_buyer_profile`, `worker.*`, `padmin.tax_documents/tax_document/act_tax_document`, ส่วนตั้งค่า `itisme` |
| Worker | `apps/api/src/billing/tax-documents.ts` (ไดรเวอร์ `mssql` 12.7.4) |
| PDF | `apps/api/src/billing/tax-pdf.ts` (pdfkit 0.20.2 + ฟอนต์ Sarabun OFL จาก `@expo-google-fonts/sarabun`) |
| API ร้าน | `GET/PUT …/billing/buyer-profile`, `GET …/billing/tax-documents`, `POST …/tax-documents/:id/link`, `GET /v1/documents/:token` |
| API คอนโซล | `GET /platform/billing/tax-documents`, `GET …/:id/pdf`, `POST …/:id/retry|skip` (billing.verify) |
| คอนโซล | เมนู การเงิน → ใบเสร็จ / ใบกำกับภาษี; ตั้งค่าแพลตฟอร์ม → ใบเสร็จ ITISME |
| เว็บร้าน / มือถือ | หน้าแพ็กเกจ: ข้อมูลออกใบเสร็จ + รายการเอกสาร + เปิด PDF |
| ทดสอบ | `tests/tax-documents.test.mjs` (6 ข้อ ใช้ ITISME จำลอง) |

## ขั้นตอนเปิดใช้ (ผู้ใช้ทำ)

1. สร้าง `ITISME_TEST` (โครงสร้างเหมือน ITISME + แถว Company, ไม่มีข้อมูลลูกค้า) — Claude ถูกระบบตรวจสิทธิ์บล็อกไม่ให้เขียนสคริปต์นี้
2. `sqlcmd -S localhost -U sa -C -v DB=ITISME_TEST -i 02_koochang_objects.sql`
3. สร้าง login `koochang_billing` (รหัสสุ่ม เก็บใน password manager) + user ใน ITISME_TEST ให้ `EXECUTE` เฉพาะ `sp_KC_IssueReceipt`, `sp_KC_IssueCreditNote`, `sp_KC_Company`
4. Deploy คู่ช่าง (migration 034) → คอนโซล ตั้งค่าแพลตฟอร์ม → ใบเสร็จ ITISME: localhost / 1433 / ITISME_TEST / koochang_billing / รหัส → เปิดใช้งาน
5. จ่ายเงินทดสอบ → ดูเอกสารในคอนโซล + เปิด PDF → ตรวจแถวใน ITISME_TEST
6. ผ่านแล้ว: รัน 02 บน ITISME, เพิ่ม user ใน ITISME, เปลี่ยนฐานในคอนโซลเป็น ITISME — **เอกสารที่ค้างระหว่างปิดจะออกตอนเปิด ด้วยวันที่รับเงินเดิม** ถ้าไม่ต้องการให้กด "ข้าม" ก่อนเปิด

## ข้อควรระวัง / ต้องถามนักบัญชี

- โปรแกรมเดิมยังคิดเลขเอง: ถ้าออกเอกสารพร้อมกันในวินาทีเดียวกัน ฝั่งที่บันทึกทีหลังจะติด PK (ไม่มีเลขซ้ำ) จนกว่าจะแก้ให้เรียก `sp_NextDocNo`
- เอกสารที่รอนานแล้วออกทีหลังจะได้เลขต่อท้ายเดือนของวันรับเงิน (อาจไม่เรียงตามวันที่ในเดือน)
- ร้านนิติบุคคลจ่าย ≥ 1,000 บาท (business 1,290) อาจต้องหัก ณ ที่จ่าย 3% แต่จ่ายบัตรหักไม่ได้
- ยังไม่มีโลโก้ IT IS ME ในหัว PDF (ไม่มีไฟล์โลโก้ใน repo)
