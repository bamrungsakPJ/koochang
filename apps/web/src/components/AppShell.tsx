import { NavLink, Outlet, useNavigate } from 'react-router';
import { useSession } from '../auth/session';
import { roleLabel } from './ui';

const nav = [
  { to: '/admin', label: 'หน้าหลัก', end: true },
  { to: '/admin/team', label: 'ทีมงาน', end: false },
];

export function AppShell() {
  const { session, activeTenant, logout } = useSession();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-700 font-bold text-white">S</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight">{activeTenant?.name}</p>
            <p className="truncate text-xs text-slate-500">
              {session?.account.displayName} · {activeTenant ? roleLabel[activeTenant.role] : ''}
            </p>
          </div>
          {session && session.tenants.length > 1 && (
            <button className="text-sm text-slate-600 hover:underline" onClick={() => navigate('/select-shop')}>
              เปลี่ยนร้าน
            </button>
          )}
          <button
            className="text-sm text-slate-600 hover:underline"
            onClick={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            ออก
          </button>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${
                  isActive ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
