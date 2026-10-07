import LegalDocument from '../legal-document';
import { terms, legalReady } from '../legal-content';
export const metadata = { title: 'ข้อตกลงการใช้งาน | คู่ช่าง', description: 'ขอบเขตบริการ บัญชี แพ็กเกจ การชำระ การยกเลิก ข้อมูลร้าน และเงื่อนไขใช้งานคู่ช่าง', alternates: { canonical: 'https://koochang.com/terms' }, robots: { index: legalReady, follow: true } };
export default function Page(){return <LegalDocument title="ข้อตกลงการใช้งาน" sections={terms}/>;}
