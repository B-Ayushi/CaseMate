import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { PublicOnly, RequireAuth } from './components/RouteGuards';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { LoginPage } from './pages/auth/LoginPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { SignupPage } from './pages/auth/SignupPage';
import { EditCasePage, NewCasePage } from './pages/cases/CaseFormPage';
import { CasePage } from './pages/cases/CasePage';
import { CasesPage } from './pages/cases/CasesPage';
import { EditClientPage, NewClientPage } from './pages/clients/ClientFormPage';
import { ClientProfilePage } from './pages/clients/ClientProfilePage';
import { ClientsPage } from './pages/clients/ClientsPage';
import { NotFoundPage } from './pages/NotFoundPage';

export const router = createBrowserRouter([
  {
    element: <PublicOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignupPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
    ],
  },
  // Reachable whether or not someone is logged in, since it is opened from an email.
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/cases" replace /> },
          { path: 'cases', element: <CasesPage /> },
          { path: 'cases/new', element: <NewCasePage /> },
          { path: 'cases/:id', element: <CasePage /> },
          { path: 'cases/:id/edit', element: <EditCasePage /> },
          {
            path: 'clients',
            element: <ClientsPage />,
            children: [
              { path: 'new', element: <NewClientPage /> },
              { path: ':id', element: <ClientProfilePage /> },
              { path: ':id/edit', element: <EditClientPage /> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
