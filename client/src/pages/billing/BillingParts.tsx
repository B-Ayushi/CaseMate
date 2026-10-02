import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import {
  Alert,
  Button,
  SelectField,
  TextAreaField,
  TextField,
  TextLink,
} from '../../components/ui';
import { Modal } from '../../components/Modal';
import {
  amountForMinutes,
  invoiceStatusLabels,
  useRate,
  useSaveTimeEntry,
  type InvoiceDisplayStatus,
  type TimeEntry,
} from '../../features/billing/api';
import { useCases } from '../../features/cases/api';
import { cx } from '../../lib/cx';
import { todayIst } from '../../lib/dates';
import { applyServerErrors } from '../../lib/forms';
import { formatPaise } from '../../lib/money';
import { timeEntryFormSchema, timeTotalMinutes, type TimeEntryForm } from '../../lib/validation';

const pillStyles: Record<InvoiceDisplayStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-800 ring-slate-300',
  SENT: 'bg-sky-50 text-sky-800 ring-sky-200',
  PAID: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  OVERDUE: 'bg-red-50 text-red-800 ring-red-200',
};

export function InvoiceStatusPill({ status }: { status: InvoiceDisplayStatus }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
        pillStyles[status],
      )}
    >
      {invoiceStatusLabels[status]}
    </span>
  );
}

function RatePreview({
  caseId,
  storedRate,
  minutes,
}: {
  caseId: string;
  storedRate?: number;
  minutes: number;
}) {
  const rate = useRate(storedRate === undefined ? caseId : '');
  if (storedRate === undefined && !caseId) {
    return <p className="text-sm text-slate-600">Choose a case to see the rate.</p>;
  }
  if (storedRate === undefined && rate.isPending) {
    return <p className="text-sm text-slate-600">Looking up the rate…</p>;
  }
  if (storedRate === undefined && rate.isError) {
    return <Alert>Could not look up the rate for this case.</Alert>;
  }
  const ratePaise = storedRate ?? rate.data!.ratePaise;
  const source =
    storedRate !== undefined
      ? 'the rate when this time was logged'
      : rate.data!.source === 'client'
        ? `${rate.data!.clientName}'s rate`
        : 'your default rate';
  return (
    <div
      className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"
      role="status"
      aria-live="polite"
    >
      <p className="text-slate-700">
        Rate: <span className="font-medium text-slate-900">{formatPaise(ratePaise)} an hour</span> (
        {source})
      </p>
      <p className="mt-0.5 text-slate-700">
        Amount:{' '}
        <span className="text-base font-semibold text-slate-900">
          {formatPaise(amountForMinutes(minutes, ratePaise))}
        </span>
      </p>
      {ratePaise === 0 && storedRate === undefined && (
        <p className="mt-1 text-amber-800">
          The rate is ₹0. Set a default in <TextLink to="/settings">Settings → Billing</TextLink>,
          or give this client an hourly rate.
        </p>
      )}
    </div>
  );
}

// "Log time" and "Edit time" in one dialog. A new entry takes the case's current rate;
// an existing entry keeps the rate it was logged at.
export function TimeEntryDialog({
  entry,
  caseId: presetCaseId,
  onClose,
}: {
  entry?: TimeEntry;
  caseId?: string;
  onClose: () => void;
}) {
  const cases = useCases('ACTIVE', '');
  const save = useSaveTimeEntry();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<TimeEntryForm>({
    resolver: zodResolver(timeEntryFormSchema),
    defaultValues: entry
      ? {
          caseId: entry.case.id,
          workDate: entry.workDate,
          hours: String(Math.floor(entry.minutes / 60)),
          minutes: String(entry.minutes % 60),
          description: entry.description,
        }
      : {
          caseId: presetCaseId ?? '',
          workDate: todayIst(),
          hours: '',
          minutes: '',
          description: '',
        },
  });
  const values = useWatch({ control });
  const minutes = timeTotalMinutes({ hours: values.hours ?? '', minutes: values.minutes ?? '' });

  return (
    <Modal title={entry ? 'Edit time' : 'Log time'} onClose={onClose}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit(async (v) => {
          setFormError(null);
          try {
            await save.mutateAsync({
              id: entry?.id,
              caseId: v.caseId,
              body: {
                workDate: v.workDate,
                minutes: timeTotalMinutes(v),
                description: v.description,
              },
            });
            onClose();
          } catch (error) {
            setFormError(applyServerErrors(error, setError));
          }
        })}
      >
        {formError && <Alert>{formError}</Alert>}
        {entry ? (
          <p className="text-sm text-slate-700">
            Case: <span className="font-medium text-slate-900">{entry.case.title}</span> (
            {entry.case.client.name})
          </p>
        ) : presetCaseId ? (
          // Opened from a case page: the case is fixed (a dropdown would reset to empty
          // while the case list is still loading).
          <p className="text-sm text-slate-700">
            Case:{' '}
            <span className="font-medium text-slate-900">
              {cases.data?.find((c) => c.id === presetCaseId)?.title ?? 'This case'}
            </span>
          </p>
        ) : (
          <SelectField label="Case" required error={errors.caseId?.message} {...register('caseId')}>
            <option value="">{cases.isPending ? 'Loading cases…' : 'Choose a case'}</option>
            {cases.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({c.caseNumber}) · {c.client.name}
              </option>
            ))}
          </SelectField>
        )}
        {cases.isError && <Alert>Could not load your cases.</Alert>}
        {!entry && cases.data?.length === 0 && (
          <p className="text-sm text-slate-600">
            You have no open cases. <TextLink to="/cases/new">Add a case</TextLink> first.
          </p>
        )}
        <TextField
          label="Date"
          type="date"
          required
          error={errors.workDate?.message}
          {...register('workDate')}
        />
        <fieldset>
          <legend className="text-sm font-medium text-slate-800">Time spent</legend>
          <div className="mt-1 grid max-w-xs grid-cols-2 gap-3">
            <TextField
              label="Hours"
              inputMode="numeric"
              error={errors.hours?.message}
              {...register('hours')}
            />
            <TextField
              label="Minutes"
              inputMode="numeric"
              error={errors.minutes?.message}
              {...register('minutes')}
            />
          </div>
        </fieldset>
        <TextAreaField
          label="Work done"
          required
          hint="Shown on the invoice, for example Drafting the written statement"
          error={errors.description?.message}
          {...register('description')}
        />
        <RatePreview caseId={values.caseId ?? ''} storedRate={entry?.ratePaise} minutes={minutes} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : entry ? 'Save changes' : 'Log time'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
