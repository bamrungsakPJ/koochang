import { useNavigate } from 'react-router';
import { useSession } from '../auth/session';
import { Button, Card } from '../components/ui';

/** Technician home. Job list arrives in M1. */
export function TechHome() {
  const { session, activeTenant, logout } = useSession();
  const navigate = useNavigate();
  return (
    <main className="mx-auto min-h-screen max-w-md px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">{activeTenant?.name}</p>
          <h1 className="text-xl font-semibold">สวัสดี {session?.account.displayName}</h1>
        </div>
        {session && session.tenants.length > 1 && (
          <Button variant="ghost" className="text-sm" onClick={() => navigate('/select-shop')}>
            เปลี่ยนร้าน
          </Button>
        )}
      </header>
      <Card className="text-center">
        <p className="text-lg font-medium">ยังไม่มีงาน</p>
        <p className="mt-1 text-slate-600">เมื่อร้านมอบหมายงาน จะแจ้งเตือนทาง LINE และแสดงที่นี่</p>
      </Card>
      <Button
        variant="ghost"
        className="mt-8 w-full"
        onClick={async () => {
          await logout();
          navigate('/login', { replace: true });
        }}
      >
        ออกจากระบบ
      </Button>
    </main>
  );
}
