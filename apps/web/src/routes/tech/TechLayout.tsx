import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useSession } from '../../auth/session';

/** Phone-first shell for technicians: one column, big targets, no menus to learn. */
export function TechLayout() {
  const { session, activeTenant, logout } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const atHome = pathname === '/tech';

  return (
    <div className="mx-auto min-h-screen max-w-md">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur">
        {atHome ? (
          <span className="grid size-8 place-items-center rounded-lg bg-brand-700 font-bold text-white">S</span>
        ) : (
          <button onClick={() => navigate(-1)} className="-ml-2 grid size-10 place-items-center rounded-full text-xl hover:bg-slate-100" aria-label="ย้อนกลับ">
            ←
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">{activeTenant?.name}</p>
          <p className="truncate text-xs text-slate-500">{session?.account.displayName}</p>
        </div>
        {atHome && session && session.tenants.length > 1 && (
          <Link to="/select-shop" className="text-sm text-slate-600">
            เปลี่ยนร้าน
          </Link>
        )}
        {atHome && (
          <button
            className="text-sm text-slate-600"
            onClick={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            ออก
          </button>
        )}
      </header>
      <main className="px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}
