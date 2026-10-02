import { useEffect, useId, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../../api/http';
import { Alert, Button, Card, PageHeader, Spinner, TextLink } from '../../components/ui';
import {
  downloadInvoicePdf,
  formatMinutes,
  useBillingSummary,
  useDeleteTimeEntry,
  useInvoiceAction,
  useInvoices,
  useTimeEntries,
  type Invoice,
  type TimeEntry,
} from '../../features/billing/api';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { cx } from '../../lib/cx';
import { addMonths, formatIsoDay, formatMonth, thisMonthIst, isMonth } from '../../lib/dates';
import { formatPaise } from '../../lib/money';
import { InvoiceStatusPill, TimeEntryDialog } from './BillingParts';

function Stat({ label, value, note }: { label: string; value: string; note: ReactNode }) {
  const labelId = useId();
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <p id={labelId} className="text-sm font-medium text-slate-600">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-600">{note}</p>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function SummaryCards({ month }: { month: string }) {
  const summary = useBillingSummary(month);
  if (summary.isPending) return <Spinner label="Loading the month’s totals…" />;
  if (summary.isError) return <Alert>{errorMessage(summary.error)}</Alert>;
  const s = summary.data;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Billed"
        value={formatPaise(s.billed.paise)}
        note={`${plural(s.billed.invoices, 'invoice')} issued and sent`}
      />
      <Stat
        label="Received"
        value={formatPaise(s.received.paise)}
        note={`${plural(s.received.invoices, 'invoice')} paid this month`}
      />
      <Stat
        label="Outstanding"
        value={formatPaise(s.outstanding.paise)}
        note={
          s.outstanding.overduePaise > 0 ? (
            <span className="font-medium text-red-800">
              {formatPaise(s.outstanding.overduePaise)} overdue
            </span>
          ) : (
            `${plural(s.outstanding.invoices, 'invoice')} awaiting payment`
          )
        }
      />
      <Stat
        label="Unbilled time"
        value={formatPaise(s.unbilled.paise)}
        note={`${formatMinutes(s.unbilled.minutes)} logged this month, not invoiced`}
      />
    </div>
  );
}

function UnbilledTime({ onEdit }: { onEdit: (entry: TimeEntry) => void }) {
  const entries = useTimeEntries({ billed: 'unbilled' });
  const remove = useDeleteTimeEntry();
  const navigate = useNavigate();
  const wide = useMediaQuery('(min-width: 768px)');
  const [selected, setSelected] = useState<string[]>([]);
  const [rowError, setRowError] = useState<string | null>(null);

  if (entries.isPending) return <Spinner label="Loading unbilled time…" />;
  if (entries.isError) return <Alert>{errorMessage(entries.error)}</Alert>;
  const list = entries.data;
  if (list.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
        No unbilled time. Use “+ Log time”, or record time spent when you log a hearing outcome.
      </p>
    );
  }

  const chosen = list.filter((e) => selected.includes(e.id));
  const clientIds = [...new Set(chosen.map((e) => e.case.client.id))];
  const total = chosen.reduce((sum, e) => sum + e.amountPaise, 0);
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function onDelete(entry: TimeEntry) {
    if (!window.confirm(`Delete ${formatMinutes(entry.minutes)} on ${entry.case.title}?`)) return;
    setRowError(null);
    try {
      await remove.mutateAsync(entry.id);
      setSelected((s) => s.filter((x) => x !== entry.id));
    } catch (error) {
      setRowError(errorMessage(error));
    }
  }

  const checkbox = (e: TimeEntry) => (
    <input
      type="checkbox"
      checked={selected.includes(e.id)}
      onChange={() => toggle(e.id)}
      aria-label={`Select ${formatMinutes(e.minutes)} on ${formatIsoDay(e.workDate, 'd MMM')}, ${e.case.title}`}
      className="h-4 w-4 rounded border-slate-400 text-indigo-700 focus:ring-2 focus:ring-indigo-600"
    />
  );
  const actions = (e: TimeEntry) => (
    <div className="flex gap-1">
      <Button variant="ghost" className="px-2 py-1" onClick={() => onEdit(e)}>
        Edit<span className="sr-only"> time on {e.case.title}</span>
      </Button>
      <Button variant="ghost" className="px-2 py-1" onClick={() => onDelete(e)}>
        Delete<span className="sr-only"> time on {e.case.title}</span>
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      {rowError && <Alert>{rowError}</Alert>}
      {wide ? (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="w-8 py-2">
                <span className="sr-only">Select</span>
              </th>
              <th scope="col" className="py-2">
                Date
              </th>
              <th scope="col" className="py-2">
                Case
              </th>
              <th scope="col" className="py-2">
                Work done
              </th>
              <th scope="col" className="py-2 text-right">
                Time
              </th>
              <th scope="col" className="py-2 text-right">
                Amount
              </th>
              <th scope="col" className="py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((e) => (
              <tr key={e.id} className={selected.includes(e.id) ? 'bg-indigo-50/60' : undefined}>
                <td className="py-2">{checkbox(e)}</td>
                <td className="whitespace-nowrap py-2">{formatIsoDay(e.workDate, 'd MMM yyyy')}</td>
                <td className="py-2">
                  <TextLink to={`/cases/${e.case.id}?tab=time`}>{e.case.title}</TextLink>
                  <span className="block text-xs text-slate-600">{e.case.client.name}</span>
                </td>
                <td className="py-2">{e.description}</td>
                <td className="whitespace-nowrap py-2 text-right">{formatMinutes(e.minutes)}</td>
                <td className="whitespace-nowrap py-2 text-right font-medium">
                  {formatPaise(e.amountPaise)}
                </td>
                <td className="py-2 text-right">{actions(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="space-y-3">
          {list.map((e) => (
            <li
              key={e.id}
              className={cx(
                'rounded-lg border p-3',
                selected.includes(e.id) ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200',
              )}
            >
              <div className="flex items-start gap-3">
                <div className="pt-0.5">{checkbox(e)}</div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{e.case.title}</p>
                  <p className="text-xs text-slate-600">
                    {e.case.client.name} · {formatIsoDay(e.workDate, 'd MMM yyyy')}
                  </p>
                  <p className="mt-1 text-sm text-slate-800">{e.description}</p>
                  <p className="mt-1 text-sm">
                    {formatMinutes(e.minutes)} ·{' '}
                    <span className="font-medium">{formatPaise(e.amountPaise)}</span>
                  </p>
                </div>
              </div>
              <div className="mt-2 flex justify-end">{actions(e)}</div>
            </li>
          ))}
        </ul>
      )}

      <div
        className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3"
        aria-live="polite"
      >
        <p className="text-sm text-slate-700">
          {chosen.length === 0
            ? 'Tick entries of one client to bill them.'
            : clientIds.length > 1
              ? 'An invoice is for one client. Tick entries of a single client.'
              : `${chosen.length} ${chosen.length === 1 ? 'entry' : 'entries'} selected · ${formatPaise(total)}`}
        </p>
        <Button
          disabled={chosen.length === 0 || clientIds.length > 1}
          onClick={() =>
            navigate(
              `/billing/invoices/new?client=${clientIds[0]}&entries=${chosen.map((e) => e.id).join(',')}`,
            )
          }
        >
          Create invoice from selected
        </Button>
      </div>
    </div>
  );
}

function InvoiceActions({ invoice }: { invoice: Invoice }) {
  const action = useInvoiceAction();
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const busy = action.isPending || downloading;

  async function run(kind: 'send' | 'mark-sent' | 'mark-paid' | 'delete', success: string) {
    setMessage(null);
    try {
      await action.mutateAsync({ id: invoice.id, action: kind });
      if (kind !== 'delete') setMessage({ tone: 'success', text: success });
    } catch (error) {
      setMessage({ tone: 'error', text: errorMessage(error) });
    }
  }

  async function download() {
    setMessage(null);
    setDownloading(true);
    try {
      await downloadInvoicePdf(invoice.id);
    } catch (error) {
      setMessage({ tone: 'error', text: errorMessage(error) });
    } finally {
      setDownloading(false);
    }
  }

  const label = (text: string) => (
    <>
      {text}
      <span className="sr-only"> {invoice.number}</span>
    </>
  );
  const small = 'px-2.5 py-1 text-xs';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <Button variant="secondary" className={small} disabled={busy} onClick={download}>
          {label('Download PDF')}
        </Button>
        {invoice.status !== 'PAID' && (
          <Button
            variant="secondary"
            className={small}
            disabled={busy || !invoice.client.email}
            title={invoice.client.email ? undefined : `${invoice.client.name} has no email address`}
            onClick={() => {
              if (window.confirm(`Email ${invoice.number} to ${invoice.client.email}?`)) {
                void run('send', `Emailed to ${invoice.client.email}.`);
              }
            }}
          >
            {label(invoice.status === 'DRAFT' ? 'Send by email' : 'Email again')}
          </Button>
        )}
        {invoice.status === 'DRAFT' && (
          <Button
            variant="secondary"
            className={small}
            disabled={busy}
            onClick={() => run('mark-sent', 'Marked as sent.')}
          >
            {label('Mark as sent')}
          </Button>
        )}
        {invoice.status !== 'PAID' && (
          <Button
            variant="secondary"
            className={small}
            disabled={busy}
            onClick={() => run('mark-paid', 'Marked as paid.')}
          >
            {label('Mark paid')}
          </Button>
        )}
        {invoice.status === 'DRAFT' && (
          <Button
            variant="ghost"
            className={cx(small, 'text-red-800')}
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  `Delete draft ${invoice.number}? Its time goes back to the unbilled list.`,
                )
              ) {
                void run('delete', '');
              }
            }}
          >
            {label('Delete draft')}
          </Button>
        )}
      </div>
      {!invoice.client.email && invoice.status !== 'PAID' && (
        <p className="text-xs text-slate-600">
          No email for {invoice.client.name}: share the PDF another way and mark it as sent.
        </p>
      )}
      <div aria-live="polite">
        {message && (
          <p
            className={cx(
              'text-xs font-medium',
              message.tone === 'error' ? 'text-red-800' : 'text-emerald-800',
            )}
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}

function Invoices({ highlight }: { highlight: string | null }) {
  const invoices = useInvoices();
  const wide = useMediaQuery('(min-width: 768px)');

  useEffect(() => {
    if (!highlight || !invoices.data) return;
    document.getElementById(`invoice-${highlight}`)?.scrollIntoView({ block: 'center' });
  }, [highlight, invoices.data]);

  if (invoices.isPending) return <Spinner label="Loading invoices…" />;
  if (invoices.isError) return <Alert>{errorMessage(invoices.error)}</Alert>;
  if (invoices.data.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
        No invoices yet. Tick unbilled time above, or use “+ Create invoice”.
      </p>
    );
  }

  const rowClass = (invoice: Invoice) =>
    invoice.id === highlight ? 'bg-amber-50 ring-2 ring-inset ring-amber-300' : undefined;

  if (!wide) {
    return (
      <ul className="space-y-3">
        {invoices.data.map((invoice) => (
          <li
            key={invoice.id}
            id={`invoice-${invoice.id}`}
            className={cx('rounded-lg border border-slate-200 p-3', rowClass(invoice))}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900">{invoice.number}</p>
                <p className="text-sm text-slate-700">{invoice.client.name}</p>
              </div>
              <InvoiceStatusPill status={invoice.displayStatus} />
            </div>
            <p className="mt-1 text-sm text-slate-700">
              <span className="font-medium text-slate-900">{formatPaise(invoice.totalPaise)}</span>{' '}
              · issued {formatIsoDay(invoice.issueDate, 'd MMM')} · due{' '}
              {formatIsoDay(invoice.dueDate, 'd MMM yyyy')}
            </p>
            <div className="mt-2">
              <InvoiceActions invoice={invoice} />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
        <tr>
          <th scope="col" className="py-2">
            Invoice
          </th>
          <th scope="col" className="py-2">
            Client
          </th>
          <th scope="col" className="py-2">
            Issued
          </th>
          <th scope="col" className="py-2">
            Due
          </th>
          <th scope="col" className="py-2 text-right">
            Amount
          </th>
          <th scope="col" className="py-2 pl-6">
            Status
          </th>
          <th scope="col" className="py-2">
            Actions
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {invoices.data.map((invoice) => (
          <tr key={invoice.id} id={`invoice-${invoice.id}`} className={rowClass(invoice)}>
            <td className="py-3 font-semibold text-slate-900">{invoice.number}</td>
            <td className="py-3">
              <TextLink to={`/clients/${invoice.client.id}`}>{invoice.client.name}</TextLink>
            </td>
            <td className="whitespace-nowrap py-3">
              {formatIsoDay(invoice.issueDate, 'd MMM yyyy')}
            </td>
            <td className="whitespace-nowrap py-3">
              {formatIsoDay(invoice.dueDate, 'd MMM yyyy')}
            </td>
            <td className="whitespace-nowrap py-3 text-right font-medium">
              {formatPaise(invoice.totalPaise)}
            </td>
            <td className="py-3 pl-6">
              <InvoiceStatusPill status={invoice.displayStatus} />
            </td>
            <td className="py-3">
              <InvoiceActions invoice={invoice} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function BillingPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const monthParam = params.get('month');
  const month = isMonth(monthParam) ? monthParam : thisMonthIst();
  const highlight = params.get('invoice');
  const created = (location.state as { created?: string } | null)?.created;
  const [dialog, setDialog] = useState<{ entry?: TimeEntry } | null>(null);

  const setMonth = (next: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set('month', next);
    setParams(nextParams);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description="Time you have logged, the invoices made from it and what has been paid."
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog({})}>
              + Log time
            </Button>
            <Button onClick={() => navigate('/billing/invoices/new')}>+ Create invoice</Button>
          </>
        }
      />
      {created && <Alert tone="success">Invoice {created} created as a draft.</Alert>}

      <section aria-labelledby="month-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="month-heading"
            className="text-lg font-semibold text-slate-900"
            aria-live="polite"
          >
            {formatMonth(month)}
          </h2>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="px-3 py-1.5"
              onClick={() => setMonth(addMonths(month, -1))}
            >
              <span aria-hidden="true">←</span>
              <span className="sr-only">Previous month</span>
            </Button>
            <Button
              variant="secondary"
              className="px-3 py-1.5"
              onClick={() => setMonth(thisMonthIst())}
            >
              This month
            </Button>
            <Button
              variant="secondary"
              className="px-3 py-1.5"
              onClick={() => setMonth(addMonths(month, 1))}
            >
              <span aria-hidden="true">→</span>
              <span className="sr-only">Next month</span>
            </Button>
          </div>
        </div>
        <SummaryCards month={month} />
      </section>

      <Card title="Unbilled time">
        <UnbilledTime onEdit={(entry) => setDialog({ entry })} />
      </Card>

      <Card title="Invoices">
        <Invoices highlight={highlight} />
      </Card>

      {dialog && <TimeEntryDialog entry={dialog.entry} onClose={() => setDialog(null)} />}
    </div>
  );
}
