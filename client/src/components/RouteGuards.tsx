import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/http';
import { useSession } from '../features/auth/api';
import { safeNext } from '../lib/forms';
import { Alert, Spinner } from './ui';

function FullPageStatus({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">{children}</div>
  );
}

// Pages for logged-in lawyers. Anyone else is sent to the login page and brought back
// afterwards.
export function RequireAuth() {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) {
    return (
      <FullPageStatus>
        <Spinner />
      </FullPageStatus>
    );
  }
  if (session.isError) {
    return (
      <FullPageStatus>
        <Alert>{errorMessage(session.error)}</Alert>
      </FullPageStatus>
    );
  }
  if (!session.data) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}

// Login, signup and password pages. A lawyer who is logged in (already, or just now by
// submitting one of these forms) goes to the page they asked for, or the app's home.
export function PublicOnly() {
  const session = useSession();
  const [params] = useSearchParams();
  if (session.isPending) {
    return (
      <FullPageStatus>
        <Spinner />
      </FullPageStatus>
    );
  }
  if (session.data) {
    return <Navigate to={safeNext(params.get('next'))} replace />;
  }
  return <Outlet />;
}
