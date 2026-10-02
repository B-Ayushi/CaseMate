import { useState } from 'react';
import { errorMessage } from '../../api/http';
import { Alert, Button, Card, Spinner, TextLink } from '../../components/ui';
import {
  formatMinutes,
  useDeleteTimeEntry,
  useTimeEntries,
  type TimeEntry,
} from '../../features/billing/api';
import type { CaseDetail } from '../../features/cases/api';
import { formatIsoDay } from '../../lib/dates';
import { formatPaise } from '../../lib/money';
import { InvoiceStatusPill, TimeEntryDialog } from '../billing/BillingParts';

// A case's time entries and where each one stands in billing.
export function CaseTimeTab({ legalCase }: { legalCase: CaseDetail }) {
  const entries = useTimeEntries({ caseId: legalCase.id });
  const remove = useDeleteTimeEntry();
  const [dialog, setDialog] = useState<{ entry?: TimeEntry } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { time } = legalCase;

  async function onDelete(entry: TimeEntry) {
    if (!window.confirm(`Delete ${formatMinutes(entry.minutes)} logged on this case?`)) return;
    setError(null);
    try {
      await remove.mutateAsync(entry.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <Card
        title="Time and billing"
        actions={
          legalCase.status === 'ACTIVE' && (
            <Button variant="secondary" onClick={() => setDialog({})}>
              + Log time
            </Button>
          )
        }
      >
        <dl className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ['Total time', formatMinutes(time.totalMinutes)],
            ['Total value', formatPaise(time.totalPaise)],
            ['Not yet billed', formatMinutes(time.unbilledMinutes)],
            ['Unbilled value', formatPaise(time.unbilledPaise)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {label}
              </dt>
              <dd className="mt-0.5 text-lg font-semibold text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
        {error && (
          <div className="mb-3">
            <Alert>{error}</Alert>
          </div>
        )}
        {entries.isPending ? (
          <Spinner label="Loading time entries…" />
        ) : entries.isError ? (
          <Alert>{errorMessage(entries.error)}</Alert>
        ) : entries.data.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
            No time logged on this case yet. Log time here, or record time spent when you log a
            hearing outcome.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {entries.data.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">
                    {formatIsoDay(e.workDate, 'd MMM yyyy')} · {formatMinutes(e.minutes)} ·{' '}
                    {formatPaise(e.amountPaise)}
                  </p>
                  <p className="text-sm text-slate-700">{e.description}</p>
                  <p className="text-xs text-slate-600">
                    At {formatPaise(e.ratePaise)} an hour
                    {e.hearingId ? ' · from a hearing outcome' : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {e.invoice ? (
                    <>
                      <TextLink to={`/billing?invoice=${e.invoice.id}`} className="text-sm">
                        {e.invoice.number}
                      </TextLink>
                      <InvoiceStatusPill status={e.invoice.displayStatus} />
                    </>
                  ) : (
                    <>
                      <span className="text-xs font-medium text-slate-600">Unbilled</span>
                      <Button
                        variant="ghost"
                        className="px-2 py-1"
                        onClick={() => setDialog({ entry: e })}
                      >
                        Edit
                        <span className="sr-only">
                          {' '}
                          time on {formatIsoDay(e.workDate, 'd MMM')}
                        </span>
                      </Button>
                      <Button variant="ghost" className="px-2 py-1" onClick={() => onDelete(e)}>
                        Delete
                        <span className="sr-only">
                          {' '}
                          time on {formatIsoDay(e.workDate, 'd MMM')}
                        </span>
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {dialog && (
        <TimeEntryDialog
          entry={dialog.entry}
          caseId={legalCase.id}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
