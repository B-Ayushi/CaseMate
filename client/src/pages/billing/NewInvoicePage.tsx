import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../../api/http';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  PageHeader,
  SelectField,
  Spinner,
  TextAreaField,
  TextField,
} from '../../components/ui';
import { formatMinutes, useCreateInvoice, useTimeEntries } from '../../features/billing/api';
import { addDaysToIsoDay, formatIsoDay, todayIst } from '../../lib/dates';
import { applyServerErrors } from '../../lib/forms';
import { formatPaise } from '../../lib/money';
import { invoiceFormSchema, type InvoiceForm } from '../../lib/validation';

const DUE_DAYS = 15;

// Create an invoice: pick a client, tick their unbilled time, check the total and the
// due date, then create it as a draft. The server totals the entries itself.
export function NewInvoicePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const entries = useTimeEntries({ billed: 'unbilled' });
  const create = useCreateInvoice();
  const [formError, setFormError] = useState<string | null>(null);
  const today = todayIst();

  const preselected = (params.get('entries') ?? '').split(',').filter(Boolean);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<InvoiceForm>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: {
      clientId: params.get('client') ?? '',
      timeEntryIds: preselected,
      issueDate: today,
      dueDate: addDaysToIsoDay(today, DUE_DAYS),
      notes: '',
    },
  });
  const clientId = useWatch({ control, name: 'clientId' });
  const issueDate = useWatch({ control, name: 'issueDate' });
  const chosenIds = useWatch({ control, name: 'timeEntryIds' });

  // The due date follows the issue date (+15 days) until the lawyer changes it.
  useEffect(() => {
    if (!dirtyFields.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
      setValue('dueDate', addDaysToIsoDay(issueDate, DUE_DAYS));
    }
  }, [issueDate, dirtyFields.dueDate, setValue]);

  const all = entries.data ?? [];
  const clients = [...new Map(all.map((e) => [e.case.client.id, e.case.client])).values()].sort(
    (a, b) => a.name.localeCompare(b.name),
  );
  const forClient = all.filter((e) => e.case.client.id === clientId);
  const chosen = forClient.filter((e) => chosenIds.includes(e.id));
  const total = chosen.reduce((sum, e) => sum + e.amountPaise, 0);

  // Choosing a client ticks all of their unbilled time (unless some was passed in).
  function chooseClient(id: string) {
    setValue('clientId', id, { shouldValidate: true });
    setValue(
      'timeEntryIds',
      all.filter((e) => e.case.client.id === id).map((e) => e.id),
      { shouldValidate: true },
    );
  }

  const toggle = (id: string) =>
    setValue(
      'timeEntryIds',
      chosenIds.includes(id) ? chosenIds.filter((x) => x !== id) : [...chosenIds, id],
      { shouldValidate: true },
    );

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const invoice = await create.mutateAsync({
        clientId: values.clientId,
        timeEntryIds: values.timeEntryIds.filter((id) => forClient.some((e) => e.id === id)),
        issueDate: values.issueDate,
        dueDate: values.dueDate,
        notes: values.notes || null,
      });
      navigate(`/billing?invoice=${invoice.id}`, { state: { created: invoice.number } });
    } catch (error) {
      setFormError(applyServerErrors(error, setError));
    }
  });

  return (
    <div className="space-y-6">
      <div>
        <Link to="/billing" className="text-sm text-indigo-700 hover:underline">
          ← Billing
        </Link>
        <PageHeader
          title="Create invoice"
          description="Choose a client and the time to bill. The invoice starts as a draft."
        />
      </div>

      {entries.isPending ? (
        <Spinner label="Loading unbilled time…" />
      ) : entries.isError ? (
        <Alert>{errorMessage(entries.error)}</Alert>
      ) : clients.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-700">
            There is no unbilled time to invoice. Log time first, or record time spent when you log
            a hearing outcome.
          </p>
          <div className="mt-4">
            <ButtonLink to="/billing" variant="secondary">
              Back to billing
            </ButtonLink>
          </div>
        </Card>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          {formError && <Alert>{formError}</Alert>}
          <Card title="1. Client">
            <SelectField
              label="Client"
              required
              value={clientId}
              error={errors.clientId?.message}
              onChange={(event) => chooseClient(event.target.value)}
            >
              <option value="">Choose a client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
          </Card>

          {clientId && (
            <Card title="2. Time to bill">
              <fieldset>
                <legend className="sr-only">Unbilled time for this client</legend>
                <ul className="divide-y divide-slate-100">
                  {forClient.map((e) => (
                    <li key={e.id}>
                      <label className="flex cursor-pointer items-start gap-3 py-3">
                        <input
                          type="checkbox"
                          checked={chosenIds.includes(e.id)}
                          onChange={() => toggle(e.id)}
                          className="mt-1 h-4 w-4 rounded border-slate-400 text-indigo-700 focus:ring-2 focus:ring-indigo-600"
                        />
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="block font-medium text-slate-900">
                            {formatIsoDay(e.workDate, 'd MMM yyyy')} · {e.case.title}
                          </span>
                          <span className="block text-slate-700">{e.description}</span>
                        </span>
                        <span className="shrink-0 text-right text-sm">
                          <span className="block font-medium">{formatPaise(e.amountPaise)}</span>
                          <span className="block text-xs text-slate-600">
                            {formatMinutes(e.minutes)}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
              {errors.timeEntryIds?.message && (
                <p className="mt-2 text-sm text-red-700">{errors.timeEntryIds.message}</p>
              )}
            </Card>
          )}

          {clientId && (
            <Card title="3. Review">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Issue date"
                  type="date"
                  required
                  error={errors.issueDate?.message}
                  {...register('issueDate')}
                />
                <TextField
                  label="Due date"
                  type="date"
                  required
                  hint={`${DUE_DAYS} days after the issue date unless you change it`}
                  error={errors.dueDate?.message}
                  {...register('dueDate')}
                />
              </div>
              <div className="mt-4">
                <TextAreaField
                  label="Notes on the invoice"
                  hint="For example how to pay"
                  error={errors.notes?.message}
                  {...register('notes')}
                />
              </div>
              <div
                className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4"
                aria-live="polite"
              >
                <p className="text-sm text-slate-700">
                  {chosen.length} {chosen.length === 1 ? 'entry' : 'entries'} · Total{' '}
                  <span className="text-lg font-semibold text-slate-900">{formatPaise(total)}</span>
                </p>
                <Button type="submit" disabled={isSubmitting || chosen.length === 0}>
                  {isSubmitting ? 'Creating…' : 'Create invoice'}
                </Button>
              </div>
            </Card>
          )}
        </form>
      )}
    </div>
  );
}
