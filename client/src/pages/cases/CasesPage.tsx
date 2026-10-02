import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../api/http';
import { Alert, Badge, ButtonLink, EmptyState, PageHeader, Spinner } from '../../components/ui';
import { useCases } from '../../features/cases/api';
import { cx } from '../../lib/cx';
import { formatDay, formatTime } from '../../lib/dates';

const filters = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'ALL', label: 'All' },
] as const;

type Filter = (typeof filters)[number]['value'];

export function CasesPage() {
  const [status, setStatus] = useState<Filter>('ACTIVE');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const cases = useCases(status, deferredSearch);
  const filtered = status !== 'ACTIVE' || deferredSearch !== '';

  return (
    <>
      <PageHeader
        title="Cases"
        description="Your case diary. Cases with the soonest hearing come first."
        actions={<ButtonLink to="/cases/new">Add case</ButtonLink>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Show cases"
          className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5"
        >
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={status === f.value}
              onClick={() => setStatus(f.value)}
              className={cx(
                'rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-indigo-600',
                status === f.value
                  ? 'bg-indigo-700 text-white'
                  : 'text-slate-700 hover:bg-slate-100',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label htmlFor="case-search" className="sr-only">
          Search cases
        </label>
        <input
          id="case-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by title, number, court, client or party"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600 sm:max-w-sm"
        />
      </div>

      {cases.isPending ? (
        <Spinner label="Loading cases…" />
      ) : cases.isError ? (
        <Alert>{errorMessage(cases.error)}</Alert>
      ) : cases.data.length === 0 ? (
        filtered ? (
          <EmptyState title="No cases match">Try another search or filter.</EmptyState>
        ) : (
          <EmptyState
            title="No cases yet"
            action={<ButtonLink to="/cases/new">Add your first case</ButtonLink>}
          >
            Add a case with its court and hearing date. CaseMate will remind you before every
            hearing.
          </EmptyState>
        )
      ) : (
        <ul className="space-y-3">
          {cases.data.map((c) => (
            <li key={c.id}>
              <Link
                to={`/cases/${c.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-300 focus-visible:outline-2 focus-visible:outline-indigo-600"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{c.title}</p>
                    <p className="text-sm text-slate-600">
                      {c.caseNumber} · {c.client.name}
                    </p>
                    <p className="text-sm text-slate-600">
                      {c.courtName}
                      {c.courtroom && `, ${c.courtroom}`}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    {c.status === 'CLOSED' ? (
                      <Badge>Closed</Badge>
                    ) : c.nextHearing ? (
                      <>
                        <p className="font-medium text-slate-900">
                          {formatDay(c.nextHearing.scheduledAt)}
                        </p>
                        <p className="text-slate-600">{formatTime(c.nextHearing.scheduledAt)}</p>
                      </>
                    ) : (
                      <Badge tone="amber">No next date</Badge>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
