'use client';
import { useEffect, useState } from 'react';
import { BrandMark } from './brand';
import './landing.css';
import { ProductHero, ProductShowcase } from './product-showcase';
type Plan = { code: string; name_th: string; kind: string; technician_seats: number; storage_bytes: string; trial_days: number; amount_minor: number; currency: string; interval_unit: string };
// Matches the trial plan's trial_days in billing; the pricing section reads the live value.
const TRIAL_DAYS = 14;
// The landing page is Thai, so links into the shop open in Thai unless the visitor already chose a language there.
const SIGNUP = '/shop?signup=1&lang=th';
const SIGNIN = '/shop?lang=th';
// Google Play listing; until it is set (store review pending) the badge shows with "coming soon" and no link.
const PLAY_URL = process.env.NEXT_PUBLIC_PLAY_STORE_URL || '';
function PlayBadge() {
 // Google's official badge artwork, unchanged (brand rules); Thai version.
 const img = <img src="https://play.google.com/intl/en_us/badges/static/images/badges/th_badge_web_generic.png" alt="ดาวน์โหลดได้ที่ Google Play" width={180} height={53} loading="lazy" />;
 return <div className="lp-play">{PLAY_URL ? <a href={PLAY_URL} target="_blank" rel="noopener" aria-label="ดาวน์โหลดแอปคู่ช่างบน Google Play">{img}</a>
  : <><span className="lp-play-soon" aria-disabled="true">{img}</span><small>แอปช่างบน Google Play เร็ว ๆ นี้</small></>}</div>;
}
const assurances = ['ไม่ต้องใช้บัตรเครดิต', 'ไม่ตัดเงินอัตโนมัติ', 'ใช้ได้ทุกฟีเจอร์'];
const features = [
 ['01', 'คิวงานชัด ทีมทำงานคล่อง', 'สร้างงาน นัดหมาย และมอบหมายช่าง เจ้าของร้านติดตามสถานะได้จากหน้าเดียว'],
 ['02', 'ประวัติครบ จบในที่เดียว', 'เชื่อมลูกค้า อุปกรณ์ รูปภาพ และผลบริการ ค้นหางานเดิมได้เมื่อลูกค้ากลับมา'],
 ['03', 'ถึงรอบล้าง ถึงรอบดูแล ไม่หลุด', 'ตั้งรอบบำรุงรักษาต่อเครื่อง เช่น ล้างแอร์ทุก 6 เดือน ระบบแจ้งร้านเมื่อถึงกำหนด ได้งานซ้ำจากลูกค้าเดิม'],
 ['04', 'ถ่ายป้ายเครื่อง AI ช่วยกรอก', 'ถ่ายรูปป้ายเครื่อง AI อ่านยี่ห้อ รุ่น และ Serial ให้ ช่างตรวจสอบและแก้ไขก่อนบันทึก'],
 ['05', 'เจ้าของร้านและช่าง เชื่อมกัน', 'เจ้าของจัดการผ่านเว็บ ช่างดูงานและบันทึกผลผ่านแอป พร้อมสิทธิ์ตามบทบาท'],
 ['06', 'ช่างคนเดียวก็ใช้ได้ ทีมใหญ่ก็รองรับ', 'เริ่มจากเจ้าของที่รับงานเอง แล้วเพิ่มช่างเมื่อร้านโต รองรับภาษาไทยและอังกฤษ'],
];
export default function Landing() {
 const [plans,setPlans]=useState<Plan[]>([]); const [state,setState]=useState<'loading'|'ready'|'error'>('loading'); const [year,setYear]=useState(false);
 const load=async()=>{setState('loading');try{const r=await fetch(`${process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000'}/v1/catalog`,{cache:'no-store'});if(!r.ok)throw Error();const data=await r.json();if(!Array.isArray(data.items))throw Error();setPlans(data.items);setState('ready');}catch{setState('error');}};
 useEffect(()=>{void load();},[]);
 const trial=plans.find(p=>p.kind==='trial'); const paid=plans.filter(p=>p.kind==='paid'&&p.interval_unit===(year?'year':'month'));
 const money=(p:Plan,minor=p.amount_minor)=>new Intl.NumberFormat('th-TH',{style:'currency',currency:p.currency,maximumFractionDigits:0}).format(minor/100);
 const label=(p:Plan)=>p.technician_seats===0?'สำหรับช่างที่รับงานเอง':p.technician_seats>=Math.max(...paid.map(x=>x.technician_seats))?'สำหรับร้านที่มีหลายทีม':'แนะนำสำหรับทีมเล็ก';
 const yearNote=(p:Plan)=>{const m=plans.find(x=>x.code===p.code&&x.kind==='paid'&&x.interval_unit==='month');const save=m?m.amount_minor*12-p.amount_minor:0;return `เฉลี่ย ${money(p,Math.round(p.amount_minor/12))} ต่อเดือน${save>0?` · ประหยัด ${money(p,save)} ต่อปี`:''}`;};
 return <div className="landing">
 <a className="lp-skip" href="#content">ข้ามไปเนื้อหา</a>
 <header className="lp-nav"><a className="lp-brand" href="/" aria-label="คู่ช่าง หน้าแรก"><BrandMark /><strong>คู่ช่าง<span>KooChang</span></strong></a><nav aria-label="เมนูหลัก"><a href="#screens">หน้าจอแอป</a><a href="#features">ฟีเจอร์</a><a href="#how">วิธีทำงาน</a><a href="#pricing">แพ็กเกจ</a><a className="lp-signin" href={SIGNIN}>เข้าสู่ระบบ</a><a className="lp-nav-cta" href={SIGNUP}>ทดลองฟรี {TRIAL_DAYS} วัน</a></nav></header>
 <main id="content" className="lp-main">
 <section className="lp-hero"><div><a className="lp-badge" href={SIGNUP}><b>ฟรี {TRIAL_DAYS} วัน</b>ทดลองใช้ครบทุกฟีเจอร์ ไม่ต้องใช้บัตร <span aria-hidden>→</span></a><h1><b className="lp-nb">โปรแกรม</b><b className="lp-nb">จัดการงานช่าง</b><br/><b className="lp-nb">ให้ร้านไปได้</b><span>ไกลกว่า</span></h1><p>จัดคิวงาน มอบหมายช่าง เก็บประวัติลูกค้าและเครื่อง{' '}<br/>พร้อมเตือนรอบล้างและบำรุงรักษา ไม่ต้องจดสมุดหรือค้นแชต{' '}<br/>เจ้าของใช้เว็บ ช่างใช้แอปมือถือ ข้อมูลชุดเดียวกัน</p><div className="lp-actions"><a className="lp-primary lp-cta-trial" href={SIGNUP}>ทดลองใช้ฟรี {TRIAL_DAYS} วัน <span>↗</span></a><a className="lp-secondary" href="#screens">ดูการทำงานจริง</a></div><ul className="lp-assure">{assurances.map(x=><li key={x}>{x}</li>)}</ul><div className="lp-small">เว็บสำหรับเจ้าของร้าน · แอป Android สำหรับช่าง · ไทย / English</div><PlayBadge /></div>
 <ProductHero /></section>
 <div className="lp-strip"><span>เหมาะกับ</span><b>ร้านแอร์และล้างแอร์</b><b>ช่างซ่อมเครื่องใช้ไฟฟ้า</b><b>เครื่องกรองน้ำและน้ำอุ่น</b><b>งานติดตั้งและบริการนอกสถานที่</b></div>
 <ProductShowcase /><section id="features" className="lp-section"><span className="lp-kicker">เครื่องมือที่เข้าใจงานของคุณ</span><h2>เรื่องหลังบ้านเบาลง<br/>งานบริการดีขึ้น</h2><p className="lp-desc">ข้อมูลที่เคยกระจายอยู่ในแชต สมุด และรูปภาพ มาอยู่ในขั้นตอนการทำงานเดียวกัน</p><div className="lp-features">{features.map(([n,title,body])=><article key={n}><span className="lp-num">{n}</span><h3>{title}</h3><p>{body}</p></article>)}</div></section>
 <section id="how" className="lp-how lp-section"><div><span className="lp-kicker">จากรับงาน ถึงดูแลครั้งถัดไป</span><h2>หนึ่งระบบ<br/>ทุกจังหวะของงาน</h2><a className="lp-secondary" href={SIGNUP}>ลองทำตามขั้นตอนนี้ ฟรี {TRIAL_DAYS} วัน ↗</a></div><ol>{[['รับงานและนัดหมาย','บันทึกลูกค้า อุปกรณ์ รายละเอียด และวันนัด'],['มอบหมายให้ทีมช่าง','ช่างดูงานที่รับผิดชอบและข้อมูลก่อนเข้าบริการ'],['บันทึกผลที่หน้างาน','เก็บผลบริการ รูปภาพ และสถานะของงาน'],['วางแผนการดูแลต่อ','เปิดประวัติเดิมและติดตามรอบบำรุงรักษา']].map(([t,d],i)=><li key={t}><span>0{i+1}</span><div><h3>{t}</h3><p>{d}</p></div></li>)}</ol></section>
 <section id="pricing" className="lp-section lp-pricing"><span className="lp-kicker">เลือกให้เหมาะกับร้านของคุณ</span><h2>แพ็กเกจที่โตไปกับทีม</h2><p className="lp-desc">เริ่มทดลองฟรีก่อน แล้วค่อยเลือกแพ็กเกจเมื่อพร้อม เจ้าของร้านไม่นับเป็นที่นั่งช่าง</p><div className="lp-toggle" role="group" aria-label="รอบการชำระ"><button aria-pressed={!year} onClick={()=>setYear(false)}>รายเดือน</button><button aria-pressed={year} onClick={()=>setYear(true)}>รายปี</button></div>
 {state==='loading'?<p role="status">กำลังโหลดแพ็กเกจ…</p>:state==='error'?<div role="alert"><p>ยังโหลดราคาไม่ได้ กรุณาลองอีกครั้ง</p><button onClick={()=>void load()}>โหลดแพ็กเกจใหม่</button></div>:<>{trial&&<div className="lp-trial"><div className="lp-trial-days"><b>{trial.trial_days}</b><span>วัน</span></div><div className="lp-trial-text"><span className="lp-trial-tag">ฟรี ไม่มีค่าใช้จ่าย</span><h3>ทดลองใช้ฟรี {trial.trial_days} วัน <span className="lp-nowrap">ครบทุกฟีเจอร์</span></h3><p>ช่างได้ {trial.technician_seats} คน · พื้นที่เก็บรูป {Number(trial.storage_bytes)/1e9} GB · ไม่ต้องใช้บัตรเครดิต · ครบกำหนดไม่ตัดเงินอัตโนมัติ</p></div><a className="lp-primary" href={SIGNUP}>เริ่มทดลองฟรี ↗</a></div>}<div className="lp-plans">{paid.map(p=><article key={p.code} className={p.code==='small_team'?'lp-plan featured':'lp-plan'}><span className="lp-plan-label">{label(p)}</span><h3>{p.name_th}</h3><div className="lp-price">{money(p)}<small> / {year?'ปี':'เดือน'}</small></div>{year&&<p>{yearNote(p)}</p>}<ul><li>{p.technician_seats>0?`เจ้าของร้าน + ช่าง ${p.technician_seats} คน`:'เจ้าของรับงานเอง ไม่มีช่างในทีม'}</li><li>พื้นที่เก็บรูป {Number(p.storage_bytes)/1e9} GB</li><li>จัดการลูกค้า อุปกรณ์ และงานบริการ</li><li>ประวัติงานและเตือนรอบบำรุงรักษา</li><li>AI ช่วยอ่านป้ายเครื่อง</li><li>ภาษาไทยและอังกฤษ</li></ul><a className={p.code==='small_team'?'lp-primary':'lp-secondary'} href={SIGNUP}>ทดลองฟรี {TRIAL_DAYS} วัน ↗</a></article>)}</div>{!paid.length&&<p>ยังไม่มีแพ็กเกจที่เผยแพร่สำหรับรอบนี้</p>}<p className="lp-small">ทุกร้านเริ่มด้วยทดลองฟรี {TRIAL_DAYS} วัน ครบกำหนดแล้วเลือกแพ็กเกจและชำระเพื่อใช้งานต่อ เปลี่ยนแพ็กเกจได้เมื่อทีมโตขึ้น</p></>}
 </section>
 <section className="lp-section lp-faq"><div><span className="lp-kicker">รู้จักคู่ช่างให้มากขึ้น</span><h2>คำถามที่พบบ่อย</h2></div><div>{[[`ทดลองใช้ฟรี ${TRIAL_DAYS} วัน มีเงื่อนไขอะไรไหม?`,`ไม่มีค่าใช้จ่าย และไม่ต้องใช้บัตรเครดิต สมัครด้วยเบอร์มือถือแล้วสร้างร้านได้ทันที ใช้ได้ทุกฟีเจอร์ ${TRIAL_DAYS} วัน ครบกำหนดระบบไม่ตัดเงินอัตโนมัติ ถ้าต้องการใช้ต่อให้เลือกแพ็กเกจและชำระ ข้อมูลที่บันทึกไว้ระหว่างทดลองยังอยู่`],['ใช้กับร้านแอร์หรือร้านล้างแอร์ได้ไหม?','ได้ บันทึกแอร์แต่ละเครื่องของลูกค้า ยี่ห้อ รุ่น Serial ประวัติการล้างและซ่อม และตั้งรอบล้างครั้งถัดไปเพื่อให้ระบบแจ้งเตือนร้าน ใช้กับเครื่องกรองน้ำ เครื่องทำน้ำอุ่น และอุปกรณ์อื่นที่ต้องดูแลตามรอบได้เช่นกัน'],['เป็นช่างคนเดียว ไม่มีลูกทีม ใช้ได้ไหม?','ได้ เจ้าของร้านรับงานและบันทึกบริการเองได้ทั้งหมด แพ็กเกจเดี่ยวทำมาสำหรับช่างที่ทำงานคนเดียว และเพิ่มช่างได้เมื่อร้านโตขึ้น'],['ใช้งานบนอุปกรณ์อะไรได้บ้าง?','เจ้าของร้านใช้งานผ่านเว็บเบราว์เซอร์บนคอมพิวเตอร์หรือมือถือ ทีมช่างใช้แอปคู่ช่างบนมือถือ Android 7.0 ขึ้นไป'],['AI อ่านป้ายเครื่องได้แม่นยำแค่ไหน?','AI ช่วยเสนอข้อมูลจากรูปป้ายเครื่อง ความชัดของภาพมีผลต่อการอ่าน ควรตรวจสอบข้อมูลทุกครั้งก่อนบันทึก'],['เปลี่ยนแพ็กเกจได้อย่างไร?','เจ้าของร้านดูแพ็กเกจและจัดการสมาชิกได้ในพื้นที่ร้าน ตรวจสอบสิทธิ์ จำนวนช่าง พื้นที่ และวันมีผลก่อนยืนยัน']].map(([q,a])=><details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div></section>
 <section className="lp-cta"><span className="lp-kicker">ทดลองใช้ฟรี {TRIAL_DAYS} วัน</span><h2>ลองใช้กับงานจริงของร้านคุณ<br/>ก่อนตัดสินใจ</h2><p className="lp-desc">สร้างร้านด้วยเบอร์มือถือ เพิ่มลูกค้าและเปิดงานแรกได้ในไม่กี่นาที</p><a className="lp-primary lp-cta-trial" href={SIGNUP}>เริ่มทดลองฟรี {TRIAL_DAYS} วัน ↗</a><ul className="lp-assure">{assurances.map(x=><li key={x}>{x}</li>)}</ul><PlayBadge /></section>
 </main><footer className="lp-footer"><a className="lp-brand" href="/"><BrandMark /><strong>คู่ช่าง<span>คู่คิดของร้าน คู่มือของช่าง</span></strong></a><span>© {new Date().getFullYear()} KooChang</span><a href={SIGNIN}>เข้าสู่ระบบร้าน</a><a href="/privacy">นโยบายความเป็นส่วนตัว</a><a href="/terms">ข้อตกลงการใช้งาน</a></footer></div>;
}



