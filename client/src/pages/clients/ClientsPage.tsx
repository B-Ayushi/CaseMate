import { useDeferredValue, useState } from 'react';
import { NavLink, Outlet, useMatch } from 'react-router-dom';
import { errorMessage } from '../../api/http';
import { Alert, ButtonLink, EmptyState, PageHeader, Spinner } from '../../components/ui';
import { useClients } from '../../features/clients/api';
import { cx } from '../../lib/cx';
import { formatDay } from '../../lib/dates';

// Lists every client on the left and shows the selected one on the right. On small
// screens the list and the profile are separate pages.
export function ClientsPage() {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const clients = useClients(deferredSearch);
  const detailOpen = useMatch('/clients/:id/*') !== null;
  const hasAnyClients = (clients.data?.length ?? 0) > 0 || deferredSearch !== '';

  return (
    <>
      <PageHeader
        title="Clients"
        description="Contact details, cases, billing and notes for each client."
        actions={<ButtonLink to="/clients/new">Add client</ButtonLink>}
      />

      {clients.isPending ? (
        <Spinner label="Loading clients…" />
      ) : clients.isError ? (
        <Alert>{errorMessage(clients.error)}</Alert>
      ) : !hasAnyClients && !detailOpen ? (
        <EmptyState
          title="No clients yet"
          action={<ButtonLink to="/clients/new">Add your first client</ButtonLink>}
        >
          Add a client to keep their contact details, cases, payments and call notes in one place.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <div className={cx(detailOpen && 'hidden lg:block')}>
            <label htmlFor="client-search" className="sr-only">
              Search clients
            </label>
            <input
              id="client-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone or email"
              className="mb-3 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600"
            />
            {clients.data.length === 0 ? (
              <p className="p-3 text-sm text-slate-600">
                {deferredSearch ? `No clients match “${deferredSearch}”.` : 'No clients yet.'}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
                {clients.data.map((client) => (
                  <li key={client.id}>
                    <NavLink
                      to={`/clients/${client.id}`}
                      className={({ isActive }) =>
                        cx(
                          'block px-4 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600',
                          isActive ? 'bg-indigo-50' : 'hover:bg-slate-50',
                        )
                      }
                    >
                      <span className="block font-medium text-slate-900">{client.name}</span>
                      <span className="block text-sm text-slate-600">
                        {client.activeCaseCount === 0
                          ? 'No active cases'
                          : `${client.activeCaseCount} active case${client.activeCaseCount === 1 ? '' : 's'}`}
                        {client.nextHearingAt && ` · next ${formatDay(client.nextHearingAt)}`}
                      </span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={cx(!detailOpen && 'hidden lg:block')}>
            {detailOpen ? (
              <Outlet />
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
                Select a client to see their details.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
