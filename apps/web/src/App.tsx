import { ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { homePath, useSession } from './auth/session';
import { AppShell } from './components/AppShell';
import { AuthShell, Button, Spinner } from './components/ui';
import { CustomerDetail } from './routes/admin/CustomerDetail';
import { Customers } from './routes/admin/Customers';
import { JobDetail } from './routes/admin/JobDetail';
import { JobNew } from './routes/admin/JobNew';
import { Jobs } from './routes/admin/Jobs';
import { AdminHome } from './routes/AdminHome';
import { AssetDetail } from './routes/AssetDetail';
import { AssetNew } from './routes/AssetNew';
import { Join } from './routes/Join';
import { Login } from './routes/Login';
import { ResetPassword } from './routes/ResetPassword';
import { SelectShop } from './routes/SelectShop';
import { Signup } from './routes/Signup';
import { Team } from './routes/Team';
import { TechJob } from './routes/tech/TechJob';
import { TechLayout } from './routes/tech/TechLayout';
import { TechHome } from './routes/TechHome';

type Area = 'admin' | 'tech' | 'any';

/** Requires a session; `admin`/`tech` also require an active shop with a matching role. */
function Protected({ area, children }: { area: Area; children: ReactNode }) {
  const { loading, session, activeTenant } = useSession();
  if (loading) return <Spinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (area === 'any') return children;
  if (!activeTenant) return <Navigate to={homePath(session)} replace />;
  const isTech = activeTenant.role === 'TECHNICIAN';
  if ((area === 'tech') !== isTech) return <Navigate to={homePath(session)} replace />;
  return children;
}

/** Signed-in users skip the sign-in pages. */
function GuestOnly({ children }: { children: ReactNode }) {
  const { loading, session } = useSession();
  if (loading) return <Spinner />;
  if (session) return <Navigate to={homePath(session)} replace />;
  return children;
}

function Home() {
  const { loading, session } = useSession();
  if (loading) return <Spinner />;
  return <Navigate to={homePath(session)} replace />;
}

function NoShop() {
  const { logout } = useSession();
  return (
    <AuthShell title="ยังไม่ได้อยู่ในร้านใด" subtitle="ขอลิงก์เชิญจากเจ้าของร้าน หรือสมัครร้านใหม่">
      <Button variant="secondary" className="w-full" onClick={logout}>
        ออกจากระบบ
      </Button>
    </AuthShell>
  );
}

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/login', element: <GuestOnly><Login /></GuestOnly> },
  { path: '/signup', element: <GuestOnly><Signup /></GuestOnly> },
  { path: '/reset', element: <ResetPassword /> },
  { path: '/join/:token', element: <Join /> },
  { path: '/select-shop', element: <Protected area="any"><SelectShop /></Protected> },
  { path: '/no-shop', element: <Protected area="any"><NoShop /></Protected> },
  {
    path: '/tech',
    element: <Protected area="tech"><TechLayout /></Protected>,
    children: [
      { index: true, element: <TechHome /> },
      { path: 'jobs/:id', element: <TechJob /> },
      { path: 'assets/new', element: <AssetNew basePath="/tech" /> },
      { path: 'assets/:id', element: <AssetDetail basePath="/tech" /> },
    ],
  },
  {
    path: '/admin',
    element: <Protected area="admin"><AppShell /></Protected>,
    children: [
      { index: true, element: <AdminHome /> },
      { path: 'jobs', element: <Jobs /> },
      { path: 'jobs/new', element: <JobNew /> },
      { path: 'jobs/:id', element: <JobDetail /> },
      { path: 'customers', element: <Customers /> },
      { path: 'customers/:id', element: <CustomerDetail /> },
      { path: 'assets/new', element: <AssetNew basePath="/admin" /> },
      { path: 'assets/:id', element: <AssetDetail basePath="/admin" /> },
      { path: 'team', element: <Team /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
