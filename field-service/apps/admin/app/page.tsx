import Landing from './landing';
import type { Metadata } from 'next';
const title = 'คู่ช่าง | โปรแกรมจัดการงานช่าง แอปร้านแอร์ ทดลองใช้ฟรี 14 วัน';
const description = 'โปรแกรมจัดการงานช่างสำหรับร้านแอร์ ช่างซ่อม และทีมบริการ จัดคิวงาน มอบหมายช่าง เก็บประวัติลูกค้าและเครื่อง เตือนรอบล้างแอร์และบำรุงรักษา ใช้ได้ตั้งแต่ช่างคนเดียว ทดลองใช้ฟรี 14 วัน ไม่ต้องใช้บัตรเครดิต';
const image = { url: '/og-image.png', width: 1200, height: 630, alt: 'คู่ช่าง โปรแกรมจัดการงานช่าง เว็บสำหรับเจ้าของร้านและแอปสำหรับช่าง' };
export const metadata: Metadata = {
 title, description, alternates: { canonical: 'https://koochang.com/' },
 robots: { index: true, follow: true },
 openGraph: { title, description, url: 'https://koochang.com/', siteName: 'คู่ช่าง KooChang', locale: 'th_TH', type: 'website', images: [image] },
 twitter: { card: 'summary_large_image', title, description, images: [image.url] },
};
const structuredData = { '@context': 'https://schema.org', '@graph': [
 { '@type': 'WebSite', '@id': 'https://koochang.com/#website', url: 'https://koochang.com/', name: 'คู่ช่าง', alternateName: 'KooChang', inLanguage: 'th' },
 { '@type': 'Organization', '@id': 'https://koochang.com/#organization', name: 'คู่ช่าง KooChang', legalName: 'บริษัท ไอ ที อีส มี จำกัด', url: 'https://koochang.com/', logo: 'https://koochang.com/icon-512.png' },
 { '@type': 'SoftwareApplication', name: 'คู่ช่าง KooChang', url: 'https://koochang.com/', image: 'https://koochang.com/og-image.png', applicationCategory: 'BusinessApplication', operatingSystem: 'Web, Android', description, inLanguage: ['th', 'en'], publisher: { '@id': 'https://koochang.com/#organization' }, offers: { '@type': 'AggregateOffer', priceCurrency: 'THB', lowPrice: '0', highPrice: '1290', offerCount: 4 } },
] };
export default function Home() { return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\u003c') }} /><Landing /></>; }
