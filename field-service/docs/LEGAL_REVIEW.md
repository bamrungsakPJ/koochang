# Privacy and terms — 2026-10-07

Provider supplied by user: บริษัท ไอ ที อีส มี จำกัด, 99/111 หมู่ 11 ตำบลบางรักพัฒนา อำเภอบางบัวทอง จังหวัดนนทบุรี 11110; support@itisme.co.th.

Public pages: /privacy and /terms, version 1.0, publication 7 October 2026. Footer links and sitemap entries included. Publication does not record user assent and is not a blanket PDPA consent mechanism.

## Legal research

- PDPA: notice, lawful basis, purpose limitation, data-subject rights, security, controller/processor roles and overseas transfer. Government materials: https://personal.prd.go.th/th/content/category/detail/id/1832/iid/100260 and https://www.drt.go.th/guidelinespdpa .
- Electronic Transactions Act, updated text from ETDA: https://www.etda.or.th/th/Useful-Resource/laws-sharing.aspx (linked updated Act). Electronic publication alone does not establish affirmative agreement by every viewer.
- Unfair Contract Terms Act: official Administrative Court library https://aclib.admincourt.go.th/book/68b73a27b69d8 . Avoided blanket no-refunds, unrestricted unilateral retrospective changes, mandatory exclusive forum and blanket liability waivers.

## Verified system mapping

- Shop controls customer/work records; platform controls its own account/payment/security purposes. Tenant permissions, owner consent for scoped support reads; backend support and privacy controllers.
- DeeSMSx sends phone/message; EasySlip receives slip + matching data; Stripe receives transaction data; Anthropic OCR receives selected equipment image. Each invoked according to enabled feature. No claim that every provider is active or that foreign-transfer compliance has been independently certified.
- Browser: shop storage helpers and console sessionStorage; no Google Analytics/tag manager found in inspected frontend. Cloudflare network processing disclosed.
- Server policy read-only inspection: business_retention_days=30, deletion_cooling_days=7. SQL uses maximum, so 30 days after request. Worker erasure and restore replay; 35-day backup rotation per deployment runbook; 24-hour export per migration 019. No promise of immediate deletion or complete photo archive export.
- Paid periods use immutable snapshots; no invented automatic Stripe charging or universal refund refusal.

## Follow-up operational items

- Review the draft obligations with Thai legal counsel before commercial launch; public pages are not a legal-compliance certification.
- Assess and document processor contracts, Anthropic/provider regions and overseas-transfer safeguards. Do not imply current safeguards have been verified solely by publishing policy.
- Define and enforce a retention schedule for account/security/audit/financial records, with specific statutory basis per record class; current policy describes necessity criteria rather than inventing fixed periods.
- Add versioned affirmative terms acceptance to signup/checkout and store version/time if contractual assent is needed. Privacy notice acknowledgement must stay distinct from optional consent. Not implemented by this website-page task.
- Review rights-request runbook and whether exceptional deletion requests need bypass of technical cooling/payment restrictions under applicable law.
- Publish updates whenever server retention policy, providers, analytics or processing purposes change.
