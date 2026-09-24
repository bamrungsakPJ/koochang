import { Link } from 'react-router';
import { useSession } from '../auth/session';
import { Card } from '../components/ui';

/** Placeholder until the dashboard lands in M2; points new shops at their first step. */
export function AdminHome() {
  const { session } = useSession();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">สวัสดี {session?.account.displayName}</h1>
        <p className="text-slate-600">วันนี้มีอะไรต้องจัดการ — แดชบอร์ดจะมาในเวอร์ชันถัดไป</p>
      </div>
      <Card>
        <h2 className="font-semibold">เริ่มต้นใช้งาน</h2>
        <ol className="mt-3 space-y-3">
          <li className="flex items-start gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-700 text-sm font-semibold text-white">1</span>
            <div>
              <p className="font-medium">เชิญช่างเข้าทีม</p>
              <p className="text-sm text-slate-600">ส่งลิงก์ทาง LINE ช่างกดแล้วเข้าร่วมได้ทันที</p>
              <Link to="/admin/team" className="mt-1 inline-block text-sm font-medium text-brand-700 hover:underline">
                ไปที่ทีมงาน →
              </Link>
            </div>
          </li>
          <li className="flex items-start gap-3 opacity-60">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-300 text-sm font-semibold text-white">2</span>
            <div>
              <p className="font-medium">เพิ่มลูกค้าและเครื่องที่ติดตั้ง</p>
              <p className="text-sm text-slate-600">เร็ว ๆ นี้</p>
            </div>
          </li>
        </ol>
      </Card>
    </div>
  );
}
