import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { authApi, SESSION_KEY, useLawyer } from '../features/auth/api';
import { cx } from '../lib/cx';
import { navItems } from './navItems';

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-700 text-sm font-bold text-white"
      >
        CM
      </span>
      <span className="text-lg font-semibold text-slate-900">CaseMate</span>
    </div>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main">
      <ul className="space-y-1">
        {navItems.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-indigo-600',
                  isActive ? 'bg-indigo-50 text-indigo-800' : 'text-slate-700 hover:bg-slate-100',
                )
              }
            >
              <item.icon aria-hidden="true" className="h-5 w-5 shrink-0" />
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function AccountBox() {
  const lawyer = useLawyer();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await authApi.logout();
    } finally {
      queryClient.clear();
      queryClient.setQueryData(SESSION_KEY, null);
      navigate('/login', { replace: true });
    }
  }

  return (
    <div className="border-t border-slate-200 pt-4">
      <p className="truncate text-sm font-medium text-slate-900">{lawyer.name}</p>
      <p className="truncate text-xs text-slate-600">{lawyer.email}</p>
      <button
        type="button"
        onClick={logout}
        disabled={busy}
        className="mt-2 text-sm font-medium text-slate-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-indigo-600"
      >
        {busy ? 'Logging out…' : 'Log out'}
      </button>
    </div>
  );
}

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const menuButton = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  // Move focus to the page after each navigation, so keyboard and screen-reader users
  // start at the new content. (Nav links close the mobile menu themselves.)
  useEffect(() => {
    mainRef.current?.focus();
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <Brand />
        <button
          ref={menuButton}
          type="button"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={() => setMenuOpen((open) => !open)}
          className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-600"
        >
          <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </header>

      {menuOpen && (
        <div id="mobile-menu" className="fixed inset-0 z-20 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/30"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-x-0 top-[57px] flex flex-col gap-4 border-b border-slate-200 bg-white p-4 shadow-lg">
            <Navigation onNavigate={() => setMenuOpen(false)} />
            <AccountBox />
          </div>
        </div>
      )}

      <div className="lg:flex">
        <aside className="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col lg:gap-6 lg:border-r lg:border-slate-200 lg:bg-white lg:p-5">
          <Brand />
          <div className="flex-1">
            <Navigation />
          </div>
          <AccountBox />
        </aside>

        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          className="flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:ml-64 lg:px-8 lg:py-8"
        >
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
