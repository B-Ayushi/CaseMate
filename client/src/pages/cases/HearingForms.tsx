import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import {
  Alert,
  Button,
  CheckboxField,
  SelectField,
  TextAreaField,
  TextField,
} from '../../components/ui';
import { useTimeEntries } from '../../features/billing/api';
import {
  outcomeLabels,
  useAddHearing,
  useEditOutcome,
  useLogOutcome,
  useUpdateHearing,
  type Hearing,
  type HearingOutcome,
} from '../../features/cases/api';
import { formatDateTime, todayIst, toDateInput, toTimeInput } from '../../lib/dates';
import { applyServerErrors } from '../../lib/forms';
import {
  editOutcomeFormSchema,
  hearingSlotForm,
  outcomeFormSchema,
  type EditOutcomeForm,
  type HearingSlotForm,
  type OutcomeForm,
} from '../../lib/validation';

const toSlot = (values: HearingSlotForm) => ({
  date: values.date,
  time: values.time,
  purpose: values.purpose || null,
  notes: values.notes || null,
});

// Schedules a new hearing for a case, or moves an existing one.
export function HearingSlotFormCard({
  caseId,
  hearing,
  submitLabel,
  onDone,
  onCancel,
}: {
  caseId: string;
  hearing?: Hearing;
  submitLabel: string;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const addHearing = useAddHearing(caseId);
  const updateHearing = useUpdateHearing();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<HearingSlotForm>({
    resolver: zodResolver(hearingSlotForm),
    defaultValues: hearing
      ? {
          date: toDateInput(hearing.scheduledAt),
          time: toTimeInput(hearing.scheduledAt),
          purpose: hearing.purpose ?? '',
          notes: hearing.notes ?? '',
        }
      : { date: '', time: '10:30', purpose: '', notes: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (hearing) {
        await updateHearing.mutateAsync({ id: hearing.id, slot: toSlot(values) });
      } else {
        await addHearing.mutateAsync(toSlot(values));
        reset();
      }
      onDone?.();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, { 'hearing.date': 'date' }));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <Alert>{formError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Date"
          type="date"
          required
          min={todayIst()}
          error={errors.date?.message}
          {...register('date')}
        />
        <TextField
          label="Time (IST)"
          type="time"
          required
          error={errors.time?.message}
          {...register('time')}
        />
      </div>
      <TextField label="Purpose" error={errors.purpose?.message} {...register('purpose')} />
      <TextAreaField
        label="Note for this hearing"
        hint="Shown in your reminders"
        error={errors.notes?.message}
        {...register('notes')}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

// "Log today's outcome": what happened, time spent and the next date, in one save.
export function OutcomeFormCard({ hearing }: { hearing: Hearing }) {
  const logOutcome = useLogOutcome();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<OutcomeForm>({
    resolver: zodResolver(outcomeFormSchema),
    defaultValues: {
      outcome: 'ADJOURNED',
      outcomeNotes: '',
      hours: '',
      minutes: '',
      hasNextDate: true,
      nextHearing: { date: '', time: toTimeInput(hearing.scheduledAt), purpose: '' },
      closeCase: false,
    },
  });

  const hasNextDate = useWatch({ control, name: 'hasNextDate' });
  const outcome = useWatch({ control, name: 'outcome' });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const minutes = Number(values.hours || 0) * 60 + Number(values.minutes || 0);
    try {
      await logOutcome.mutateAsync({
        id: hearing.id,
        body: {
          outcome: values.outcome,
          outcomeNotes: values.outcomeNotes || null,
          timeSpentMinutes: minutes > 0 ? minutes : null,
          nextHearing: values.hasNextDate
            ? {
                date: values.nextHearing.date,
                time: values.nextHearing.time,
                purpose: values.nextHearing.purpose || null,
                notes: null,
              }
            : null,
          closeCase: !values.hasNextDate && values.closeCase,
        },
      });
    } catch (error) {
      setFormError(
        applyServerErrors(error, setError, {
          'nextHearing.date': 'nextHearing.date',
          timeSpentMinutes: 'minutes',
        }),
      );
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-4"
      aria-label={`Outcome for ${formatDateTime(hearing.scheduledAt)}`}
    >
      {formError && <Alert>{formError}</Alert>}
      <SelectField
        label="What happened"
        required
        error={errors.outcome?.message}
        {...register('outcome')}
      >
        {(Object.keys(outcomeLabels) as HearingOutcome[]).map((value) => (
          <option key={value} value={value}>
            {outcomeLabels[value]}
          </option>
        ))}
      </SelectField>
      <TextAreaField
        label="Notes"
        error={errors.outcomeNotes?.message}
        {...register('outcomeNotes')}
      />

      <fieldset>
        <legend className="text-sm font-medium text-slate-800">Time spent</legend>
        <p className="text-xs text-slate-600">Added to billing at the client&apos;s rate.</p>
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

      <fieldset className="space-y-3 border-t border-slate-200 pt-4">
        <legend className="sr-only">Next date</legend>
        <CheckboxField label="Next date is known" {...register('hasNextDate')} />
        {hasNextDate ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label="Next date"
              type="date"
              required
              min={todayIst()}
              error={errors.nextHearing?.date?.message}
              {...register('nextHearing.date')}
            />
            <TextField
              label="Time (IST)"
              type="time"
              required
              error={errors.nextHearing?.time?.message}
              {...register('nextHearing.time')}
            />
            <TextField
              label="Purpose"
              error={errors.nextHearing?.purpose?.message}
              {...register('nextHearing.purpose')}
            />
          </div>
        ) : (
          <CheckboxField
            label="Close this case"
            hint={
              outcome === 'DISPOSED'
                ? 'The matter is disposed of. Closing stops all reminders for it.'
                : 'Closing stops all reminders. You can reopen it later.'
            }
            {...register('closeCase')}
          />
        )}
      </fieldset>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving…' : 'Save outcome'}
      </Button>
    </form>
  );
}

// Corrects a logged outcome. The time spent follows into billing, unless that time is
// already on an invoice: then the time fields are locked and the reason is shown.
export function EditOutcomeForm({
  hearing,
  caseId,
  onDone,
}: {
  hearing: Hearing;
  caseId: string;
  onDone: () => void;
}) {
  const editOutcome = useEditOutcome();
  const entries = useTimeEntries({ caseId });
  const invoiced = entries.data?.find((e) => e.hearingId === hearing.id)?.invoice ?? null;
  const [formError, setFormError] = useState<string | null>(null);
  const spent = hearing.timeSpentMinutes ?? 0;
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EditOutcomeForm>({
    resolver: zodResolver(editOutcomeFormSchema),
    defaultValues: {
      outcome: hearing.outcome ?? 'HEARD',
      outcomeNotes: hearing.outcomeNotes ?? '',
      hours: spent ? String(Math.floor(spent / 60)) : '',
      minutes: spent ? String(spent % 60) : '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const minutes = Number(values.hours || 0) * 60 + Number(values.minutes || 0);
    try {
      await editOutcome.mutateAsync({
        id: hearing.id,
        body: {
          outcome: values.outcome,
          outcomeNotes: values.outcomeNotes || null,
          timeSpentMinutes: minutes > 0 ? minutes : null,
        },
      });
      onDone();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, { timeSpentMinutes: 'minutes' }));
    }
  });

  const lockedReason = invoiced
    ? invoiced.status === 'DRAFT'
      ? `This time is on draft invoice ${invoiced.number}. Delete that draft to change it.`
      : `This time is on invoice ${invoiced.number}, which has been ${invoiced.status === 'PAID' ? 'paid' : 'sent'}, so it can't be changed.`
    : null;

  return (
    <form onSubmit={onSubmit} noValidate className="mt-3 space-y-4 border-t border-slate-200 pt-3">
      {formError && <Alert>{formError}</Alert>}
      <SelectField
        label="What happened"
        required
        error={errors.outcome?.message}
        {...register('outcome')}
      >
        {(Object.keys(outcomeLabels) as HearingOutcome[]).map((value) => (
          <option key={value} value={value}>
            {outcomeLabels[value]}
          </option>
        ))}
      </SelectField>
      <TextAreaField
        label="Notes"
        error={errors.outcomeNotes?.message}
        {...register('outcomeNotes')}
      />
      <fieldset>
        <legend className="text-sm font-medium text-slate-800">Time spent</legend>
        {lockedReason && <p className="text-xs font-medium text-amber-800">{lockedReason}</p>}
        <div className="mt-1 grid max-w-xs grid-cols-2 gap-3">
          <TextField
            label="Hours"
            inputMode="numeric"
            readOnly={!!lockedReason}
            error={errors.hours?.message}
            {...register('hours')}
          />
          <TextField
            label="Minutes"
            inputMode="numeric"
            readOnly={!!lockedReason}
            error={errors.minutes?.message}
            {...register('minutes')}
          />
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save outcome'}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
