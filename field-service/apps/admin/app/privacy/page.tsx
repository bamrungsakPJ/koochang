import LegalDocument from '../legal-document';
import { privacy, legalReady } from '../legal-content';
export const metadata = { title: 'นโยบายความเป็นส่วนตัว | คู่ช่าง', description: 'ข้อมูลที่คู่ช่างใช้ วัตถุประสงค์ ผู้ให้บริการภายนอก ระยะเวลาเก็บ และสิทธิข้อมูลส่วนบุคคล', alternates: { canonical: 'https://koochang.com/privacy' }, robots: { index: legalReady, follow: true } };
export default function Page(){return <LegalDocument title="นโยบายความเป็นส่วนตัว" sections={privacy}/>;}
