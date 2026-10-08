'use client';
import { useLanguage } from './api';

/** Staff manual for the plans page: how a published version reaches shops that already pay
 * (policy C, migration 031). Keep in step with docs/CONSOLE.md and the terms (version 1.2). */
type Section = { title: string; items: string[]; table?: { head: string[]; rows: string[][] } };
const guide: Record<'th' | 'en', { title: string; intro: string; sections: Section[] }> = {
  th: {
    title: 'คู่มือ: ปรับแพ็กเกจแล้วร้านเดิมได้อะไร (อ่านก่อนเผยแพร่)',
    intro: 'การเผยแพร่ทุกครั้งสร้างเวอร์ชันใหม่เสมอ เวอร์ชันเก่าไม่ถูกแก้ ระบบเทียบเวอร์ชันใหม่กับเวอร์ชันที่แต่ละร้านใช้อยู่ แล้วจัดการให้อัตโนมัติตามกติกาด้านล่าง ผู้ดูแลไม่ต้องแก้ร้านทีละร้าน และไม่ต้องแก้ราคาใน Stripe Dashboard เอง',
    sections: [
      { title: '1. สิ่งที่ไม่เปลี่ยนเด็ดขาด', items: [
        'รอบใช้งานที่ร้านจ่ายแล้วใช้ราคาและสิทธิ์ตามที่จ่ายจนจบรอบ',
        'ใบแจ้งชำระที่ออกไปแล้วคงยอดเดิม',
      ] },
      { title: '2. ใครได้เวอร์ชันใหม่ทันทีเมื่อถึงวันมีผล', items: [
        'ร้านใหม่ และร้านที่อยู่ในช่วงทดลองใช้ที่ซื้อแพ็กเกจครั้งแรก',
        'ร้านที่หมดช่วงผ่อนผันแล้วกลับมาซื้อใหม่',
        'ร้านที่เปลี่ยนไปแพ็กเกจอื่น หรือเปลี่ยนรอบชำระ (รายเดือน ↔ รายปี)',
      ] },
      { title: '3. ร้านเดิมที่ต่ออายุ: ระบบแบ่งเป็น "ดีขึ้น" หรือ "แย่ลง" ให้อัตโนมัติ', items: [
        'ใช้กับร้านที่ต่ออายุแพ็กเกจเดิมและรอบชำระเดิมขณะยังมีวันใช้งานหรืออยู่ในช่วงผ่อนผัน ทั้งร้านที่โอนเงิน/แนบสลิปและร้านที่ตัดบัตรอัตโนมัติ',
        'ระบบเทียบ 4 ข้อ: ราคา (รอบชำระเดียวกัน), จำนวนช่าง, พื้นที่รูป, จำนวนวันผ่อนผัน',
        'ดีขึ้น = ราคาไม่สูงขึ้น และอีก 3 ข้อไม่ลดลง → ร้านได้ตั้งแต่รอบต่ออายุถัดไป (ถ้าวันมีผลอยู่ในอนาคต นับรอบแรกที่เริ่มตั้งแต่วันนั้น) ระบบแจ้งร้าน 1 ครั้งว่าได้ของใหม่',
        'แย่ลง = ราคาสูงขึ้น หรือข้อใดข้อหนึ่งลดลง แม้จะมีข้ออื่นดีขึ้นด้วย (เช่น ขึ้นราคาแต่เพิ่มช่าง ถือว่าแย่ลง) → ต้องแจ้งล่วงหน้า 30 วัน',
      ], table: { head: ['ตัวอย่างการเปลี่ยน', 'ประเภท', 'ร้านเดิมได้เมื่อไร'], rows: [
        ['ลดราคา 590 → 490', 'ดีขึ้น', 'รอบต่ออายุถัดไป'],
        ['ราคาเท่าเดิม เพิ่มช่าง 3 → 5', 'ดีขึ้น', 'รอบต่ออายุถัดไป'],
        ['ขึ้นราคา 590 → 690', 'แย่ลง', 'รอบที่เริ่มหลังแจ้งครบ 30 วัน'],
        ['ขึ้นราคา 590 → 690 และเพิ่มช่าง 3 → 5', 'แย่ลง (ผสม)', 'รอบที่เริ่มหลังแจ้งครบ 30 วัน'],
        ['ราคาเท่าเดิม ลดพื้นที่รูป 10 → 5 GB', 'แย่ลง', 'รอบที่เริ่มหลังแจ้งครบ 30 วัน'],
      ] } },
      { title: '4. กรณีแย่ลง: นับ 30 วันอย่างไร', items: [
        'ระบบแจ้งเจ้าของร้านในแอป (และ push) ภายในประมาณ 15 นาทีหลังเผยแพร่ แม้วันมีผลจะอยู่ในอนาคต วันเริ่มนับ 30 วันคือวันที่ระบบส่งแจ้งเตือน',
        'วันเปลี่ยนของร้าน = วันที่ช้ากว่าระหว่าง "วันมีผลของเวอร์ชัน" กับ "วันแจ้ง + 30 วัน" ร้านจะเปลี่ยนเมื่อถึงรอบต่ออายุแรกที่เริ่มตั้งแต่วันนั้น',
        'ก่อนถึงวันเปลี่ยน ร้านกดต่ออายุแพ็กเกจเดิมได้ในราคาและสิทธิ์เดิม (และเลือกราคาใหม่เองได้เสมอ)',
        'ตัวอย่าง: เผยแพร่ขึ้นราคา 1 พ.ย. → แจ้งร้าน 1 พ.ย. → วันเปลี่ยน 1 ธ.ค. ร้าน A ครบรอบ 15 พ.ย. ต่อราคาเดิม 1 รอบ แล้วรอบที่เริ่ม 15 ธ.ค. ใช้ราคาใหม่; ร้าน B รายปีครบรอบ 20 ต.ค. ปีหน้า ใช้ราคาเดิมจนถึงรอบนั้น',
        'ถ้าตั้งวันมีผลไกลกว่า 30 วัน (เช่น 1 ม.ค.) ร้านเดิมเปลี่ยนตามวันมีผลนั้น',
      ] },
      { title: '5. ร้านที่ตัดบัตรอัตโนมัติ (Stripe)', items: [
        'ระบบเปลี่ยนราคาใน Stripe ให้เองก่อนการตัดเงินรอบที่ถึงวันเปลี่ยน ไม่คิดส่วนต่างตามสัดส่วน ไม่ต้องแก้ใน Stripe Dashboard',
        'ร้านที่ไม่ต้องการราคาใหม่ยกเลิกการตัดบัตรได้เองก่อนวันตัดเงิน',
        'ถ้ามีเงินเข้าด้วยยอดราคาเก่า (Stripe ออกใบแจ้งก่อนเปลี่ยนราคา) ระบบยังจับคู่ได้ ไม่ขึ้นคิวตรวจ',
        'ตรวจย้อนหลังได้ที่บันทึกการตรวจสอบ (audit) รายการ subscription.stripe_price_changed',
      ] },
      { title: '6. ลดจำนวนช่างหรือพื้นที่รูป', items: [
        'ไม่ลบช่างหรือรูปที่มีอยู่ และร้านต่ออายุได้ตามปกติแม้มีช่างเกินจำนวนใหม่',
        'ระหว่างที่เกินเกณฑ์ ร้านอนุมัติช่างเพิ่มหรืออัปโหลดรูปเพิ่มไม่ได้ จนกว่าจะลดให้อยู่ในเกณฑ์',
      ] },
      { title: '7. ข้อควรระวังก่อนกดเผยแพร่', items: [
        'ตรวจราคา วันมีผล และจำนวนช่าง/พื้นที่ให้ถูกต้อง เวอร์ชันที่เผยแพร่แล้วแก้ไม่ได้ และแจ้งเตือนส่งถึงร้านทันที',
        'ถ้าเผยแพร่ผิด ให้ออกเวอร์ชันใหม่ทับ ระบบเทียบกับเวอร์ชันล่าสุดเสมอ ถ้าเวอร์ชันใหม่ยังแย่กว่าที่ร้านใช้อยู่ ร้านจะได้แจ้งเตือนใหม่และเริ่มนับ 30 วันใหม่ ถ้าไม่แย่กว่าก็มีผลรอบถัดไปตามปกติ',
        'ใส่ราคาให้ครบทุกรอบชำระที่มีลูกค้าใช้ ถ้าเวอร์ชันใหม่ไม่มีราคารายปี ร้านรายปีจะคงเวอร์ชันเดิมที่มีราคารายปี',
        'การปิดขายแพ็กเกจ (archive) ไม่ใช่การปรับราคา: ร้านที่โอนเงินต้องเลือกแพ็กเกจอื่นตอนต่ออายุ ส่วนร้านที่ตัดบัตรยังถูกตัดราคาเดิม',
      ] },
      { title: '8. ร้านเห็นอะไร', items: [
        'แจ้งเตือน "แพ็กเกจ … จะเปลี่ยนเป็น … ตั้งแต่รอบต่ออายุที่เริ่มวันที่ …" (แย่ลง) หรือ "… ร้านของคุณได้ตั้งแต่รอบต่ออายุถัดไป" (ดีขึ้น)',
        'หน้าแพ็กเกจในแอปและเว็บร้านแสดง "ราคาต่ออายุของร้านคุณ" และวันที่จะเปลี่ยนพร้อมราคาและสิทธิ์ใหม่',
        'กติกานี้เขียนไว้ในข้อตกลงการใช้งานฉบับ 1.2 หัวข้อ "แพ็กเกจ ราคา และการชำระ" และ "การต่ออายุอัตโนมัติด้วยบัตร"',
      ] },
    ],
  },
  en: {
    title: 'Guide: what existing shops get when a plan changes (read before publishing)',
    intro: 'Every publish creates a new version; older versions are never edited. The system compares the new version with the one each shop uses and handles shops automatically by the rules below. Staff do not edit shops one by one or change prices in the Stripe Dashboard.',
    sections: [
      { title: '1. What never changes', items: [
        'Periods a shop has paid keep their price and limits until they end.',
        'Invoices already issued keep their amount.',
      ] },
      { title: '2. Who gets the new version as soon as it takes effect', items: [
        'New shops, and trial shops buying their first plan.',
        'Shops past their grace period buying again.',
        'Shops switching to another plan or billing interval (monthly ↔ yearly).',
      ] },
      { title: '3. Renewing shops: classified as "better" or "worse" automatically', items: [
        'Applies to shops renewing the same plan and interval while they still have time or are in grace — paying by transfer/slip and by card auto-renewal alike.',
        'Four things are compared: price (same interval), technician seats, photo storage, grace days.',
        'Better = price not higher and none of the other three lower → from the shop\'s next renewal (with a future effective time, the first renewal starting on or after it); owners get one notice.',
        'Worse = price higher or any limit lower, even if something else improves (a price rise with more seats is worse) → 30 days\' notice first.',
      ], table: { head: ['Example change', 'Type', 'Existing shops get it'], rows: [
        ['Price 590 → 490', 'Better', 'Next renewal'],
        ['Same price, seats 3 → 5', 'Better', 'Next renewal'],
        ['Price 590 → 690', 'Worse', 'First renewal after 30 days\' notice'],
        ['Price 590 → 690 and seats 3 → 5', 'Worse (mixed)', 'First renewal after 30 days\' notice'],
        ['Same price, storage 10 → 5 GB', 'Worse', 'First renewal after 30 days\' notice'],
      ] } },
      { title: '4. Worse changes: how the 30 days count', items: [
        'Owners are notified in the app (and by push) within about 15 minutes of publishing, even when the effective time is in the future. The 30 days start when that notice is sent.',
        'The shop\'s change date is the later of the version\'s effective time and notice + 30 days. The shop moves at its first renewal starting on or after that date.',
        'Until then the shop can renew its plan at its old price and limits (it can always pick the new price itself).',
        'Example: a price rise published on 1 Nov → notice 1 Nov → change date 1 Dec. Shop A renewing 15 Nov renews once at the old price; its period starting 15 Dec uses the new price. Yearly shop B renewing 20 Oct next year keeps the old price until then.',
        'If the effective time is more than 30 days away (e.g. 1 Jan), existing shops move from that date.',
      ] },
      { title: '5. Card auto-renewal (Stripe)', items: [
        'The system changes the price in Stripe before the charge that reaches the change date, without proration. No Stripe Dashboard edits are needed.',
        'Owners who do not want the new price cancel automatic renewal before that charge.',
        'A payment at the old amount (an invoice Stripe created before the change) still matches and does not go to review.',
        'Audit log entry: subscription.stripe_price_changed.',
      ] },
      { title: '6. Fewer seats or less storage', items: [
        'Technicians and photos are never removed, and the shop can renew even with more technicians than the new limit.',
        'While over the limit the shop cannot approve more technicians or upload more photos.',
      ] },
      { title: '7. Before you publish', items: [
        'Check price, effective time, seats and storage. A published version cannot be edited and shops are notified at once.',
        'To fix a mistake publish another version: shops are always compared with the newest one. If it is still worse than what a shop uses, the shop gets a new notice and a new 30 days; otherwise it applies at the next renewal.',
        'Include a price for every interval customers use. A version without a yearly price leaves yearly shops on the older version that has one.',
        'Archiving a plan is not a price change: transfer shops must choose another plan when renewing; card subscriptions keep their price.',
      ] },
      { title: '8. What shops see', items: [
        'A notice "The … plan changes to … for renewals starting on or after …" (worse) or "… Your shop gets it from the next renewal" (better).',
        'The plan page in the app and owner web shows "Your renewal price" and the change date with the new price and limits.',
        'These rules are in the Terms of Use version 1.2 ("Plans, prices and payment" and "Automatic card renewal").',
      ] },
    ],
  },
};

export function PlanChangeGuide() {
  const g = guide[useLanguage() === 'en' ? 'en' : 'th'];
  return <details className="panel">
    <summary><strong>{g.title}</strong></summary>
    <p>{g.intro}</p>
    {g.sections.map(s => <section key={s.title}>
      <h3>{s.title}</h3>
      <ul>{s.items.map(i => <li key={i}>{i}</li>)}</ul>
      {s.table ? <div className="table-scroll"><table><thead><tr>{s.table.head.map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{s.table.rows.map(r => <tr key={r[0]}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody></table></div> : null}
    </section>)}
  </details>;
}
