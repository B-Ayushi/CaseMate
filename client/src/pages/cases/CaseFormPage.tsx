import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, type UseFormRegister, type FieldErrors } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../../api/http';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  SelectField,
  Spinner,
  TextAreaField,
  TextField,
  TextLink,
} from '../../components/ui';
import { useLawyer, type Lawyer } from '../../features/auth/api';
import {
  useCase,
  useCreateCase,
  useUpdateCase,
  type CaseDetail,
  type CaseFields,
} from '../../features/cases/api';
import { useClients } from '../../features/clients/api';
import { todayIst } from '../../lib/dates';
import { applyServerErrors } from '../../lib/forms';
import {
  editCaseFormSchema,
  newCaseFormSchema,
  type EditCaseForm,
  type NewCaseForm,
} from '../../lib/validation';

type Choice = 'default' | 'on' | 'off';
const toOverride = (choice: Choice) => (choice === 'default' ? null : choice === 'on');
const toChoice = (value: boolean | null): Choice =>
  value === null ? 'default' : value ? 'on' : 'off';

type CaseFormValues = NewCaseForm | EditCaseForm;

function toCaseFields(values: CaseFormValues): CaseFields {
  return {
    clientId: values.clientId,
    title: values.title,
    caseNumber: values.caseNumber,
    caseType: values.caseType || null,
    courtName: values.courtName,
    courtroom: values.courtroom || null,
    judge: values.judge || null,
    opposingParty: values.opposingParty || null,
    opposingCounsel: values.opposingCounsel || null,
    notes: values.notes || null,
    emailReminderOverride: toOverride(values.emailReminderOverride),
    smsReminderOverride: toOverride(values.smsReminderOverride),
    dayBeforeReminderOverride: toOverride(values.dayBeforeReminderOverride),
    twoHourReminderOverride: toOverride(values.twoHourReminderOverride),
  };
}

const serverFieldMap = { 'firstHearing.date': 'firstHearing.date' } as const;

function CaseDetailsFields({
  register,
  errors,
}: {
  register: UseFormRegister<NewCaseForm>;
  errors: FieldErrors<NewCaseForm>;
}) {
  const clients = useClients();
  const returnTo = encodeURIComponent('/cases/new');

  return (
    <>
      <div>
        {clients.isPending ? (
          <Spinner label="Loading clients…" />
        ) : clients.isError ? (
          <Alert>{errorMessage(clients.error)}</Alert>
        ) : clients.data.length === 0 ? (
          <Alert tone="info">
            You have no clients yet.{' '}
            <TextLink to={`/clients/new?returnTo=${returnTo}`}>Add a client</TextLink> first, then
            come back to add the case.
          </Alert>
        ) : (
          <>
            <SelectField
              label="Client"
              required
              error={errors.clientId?.message}
              {...register('clientId')}
            >
              <option value="">Choose a client</option>
              {clients.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
            <p className="mt-1 text-sm">
              <TextLink to={`/clients/new?returnTo=${returnTo}`}>Add a new client</TextLink>
            </p>
          </>
        )}
      </div>
      <TextField
        label="Title"
        required
        hint="For example Gupta vs. Mehta Builders"
        error={errors.title?.message}
        {...register('title')}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Case number"
          required
          error={errors.caseNumber?.message}
          {...register('caseNumber')}
        />
        <TextField
          label="Case type"
          hint="For example Civil suit, Bail application"
          error={errors.caseType?.message}
          {...register('caseType')}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Court"
          required
          error={errors.courtName?.message}
          {...register('courtName')}
        />
        <TextField label="Courtroom" error={errors.courtroom?.message} {...register('courtroom')} />
      </div>
      <TextField label="Judge" error={errors.judge?.message} {...register('judge')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Opposing party"
          error={errors.opposingParty?.message}
          {...register('opposingParty')}
        />
        <TextField
          label="Opposing counsel"
          error={errors.opposingCounsel?.message}
          {...register('opposingCounsel')}
        />
      </div>
      <TextAreaField label="Case notes" error={errors.notes?.message} {...register('notes')} />
    </>
  );
}

function ReminderOverrides({
  register,
  lawyer,
}: {
  register: UseFormRegister<NewCaseForm>;
  lawyer: Lawyer;
}) {
  const onOff = (value: boolean) => (value ? 'on' : 'off');
  const rows = [
    {
      name: 'dayBeforeReminderOverride',
      label: 'Day-before reminder (24 hours before)',
      def: lawyer.dayBeforeEnabled,
    },
    {
      name: 'twoHourReminderOverride',
      label: 'Final reminder (2 hours before, SMS)',
      def: lawyer.twoHourEnabled,
    },
    { name: 'emailReminderOverride', label: 'Email reminders', def: lawyer.emailEnabled },
    { name: 'smsReminderOverride', label: 'SMS reminders', def: lawyer.smsEnabled },
  ] as const;

  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold text-slate-900">Reminders for this case</legend>
      <p className="text-sm text-slate-600">
        Your defaults come from Settings. Change them here only for this case.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map((row) => (
          <SelectField key={row.name} label={row.label} {...register(row.name)}>
            <option value="default">Use my default ({onOff(row.def)})</option>
            <option value="on">On for this case</option>
            <option value="off">Off for this case</option>
          </SelectField>
        ))}
      </div>
    </fieldset>
  );
}

export function NewCasePage() {
  const lawyer = useLawyer();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const createCase = useCreateCase();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<NewCaseForm>({
    resolver: zodResolver(newCaseFormSchema),
    defaultValues: {
      clientId: params.get('clientId') ?? '',
      emailReminderOverride: 'default',
      smsReminderOverride: 'default',
      dayBeforeReminderOverride: 'default',
      twoHourReminderOverride: 'default',
      firstHearing: { date: '', time: '10:30', purpose: '', notes: '' },
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const created = await createCase.mutateAsync({
        ...toCaseFields(values),
        firstHearing: {
          date: values.firstHearing.date,
          time: values.firstHearing.time,
          purpose: values.firstHearing.purpose || null,
          notes: values.firstHearing.notes || null,
        },
      });
      navigate(`/cases/${created.id}`, { replace: true });
    } catch (error) {
      setFormError(applyServerErrors(error, setError, serverFieldMap));
    }
  });

  return (
    <div className="space-y-4">
      <Link to="/cases" className="text-sm text-indigo-700 hover:underline">
        ← All cases
      </Link>
      <h1 className="text-2xl font-semibold text-slate-900">Add a case</h1>
      <Card>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError && <Alert>{formError}</Alert>}
          <CaseDetailsFields register={register} errors={errors} />

          <fieldset className="space-y-4 border-t border-slate-200 pt-4">
            <legend className="text-base font-semibold text-slate-900">First hearing</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Date"
                type="date"
                required
                min={todayIst()}
                error={errors.firstHearing?.date?.message}
                {...register('firstHearing.date')}
              />
              <TextField
                label="Time (IST)"
                type="time"
                required
                error={errors.firstHearing?.time?.message}
                {...register('firstHearing.time')}
              />
            </div>
            <TextField
              label="Purpose"
              hint="For example Evidence, Arguments, Framing of issues"
              error={errors.firstHearing?.purpose?.message}
              {...register('firstHearing.purpose')}
            />
            <TextAreaField
              label="Note for this hearing"
              hint="Shown in your reminders, for example Bring the original sale agreement"
              error={errors.firstHearing?.notes?.message}
              {...register('firstHearing.notes')}
            />
          </fieldset>

          <div className="border-t border-slate-200 pt-4">
            <ReminderOverrides register={register} lawyer={lawyer} />
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save case'}
            </Button>
            <ButtonLink to="/cases" variant="secondary">
              Cancel
            </ButtonLink>
          </div>
        </form>
      </Card>
    </div>
  );
}

function EditCaseForm({ legalCase }: { legalCase: CaseDetail }) {
  const lawyer = useLawyer();
  const navigate = useNavigate();
  const updateCase = useUpdateCase(legalCase.id);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EditCaseForm>({
    resolver: zodResolver(editCaseFormSchema),
    defaultValues: {
      clientId: legalCase.client.id,
      title: legalCase.title,
      caseNumber: legalCase.caseNumber,
      caseType: legalCase.caseType ?? '',
      courtName: legalCase.courtName,
      courtroom: legalCase.courtroom ?? '',
      judge: legalCase.judge ?? '',
      opposingParty: legalCase.opposingParty ?? '',
      opposingCounsel: legalCase.opposingCounsel ?? '',
      notes: legalCase.notes ?? '',
      status: legalCase.status,
      emailReminderOverride: toChoice(legalCase.emailReminderOverride),
      smsReminderOverride: toChoice(legalCase.smsReminderOverride),
      dayBeforeReminderOverride: toChoice(legalCase.dayBeforeReminderOverride),
      twoHourReminderOverride: toChoice(legalCase.twoHourReminderOverride),
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await updateCase.mutateAsync({ ...toCaseFields(values), status: values.status });
      navigate(`/cases/${legalCase.id}`, { replace: true });
    } catch (error) {
      setFormError(applyServerErrors(error, setError));
    }
  });

  // The new-case field components are typed for the new-case form; the edit form has the
  // same fields plus status, so they are shared safely.
  const sharedRegister = register as unknown as UseFormRegister<NewCaseForm>;
  const sharedErrors = errors as FieldErrors<NewCaseForm>;

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <CaseDetailsFields register={sharedRegister} errors={sharedErrors} />
        <SelectField
          label="Status"
          hint="Closing a case stops its reminders. You can reopen it later."
          {...register('status')}
        >
          <option value="ACTIVE">Active</option>
          <option value="CLOSED">Closed</option>
        </SelectField>
        <div className="border-t border-slate-200 pt-4">
          <ReminderOverrides register={sharedRegister} lawyer={lawyer} />
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </Button>
          <ButtonLink to={`/cases/${legalCase.id}`} variant="secondary">
            Cancel
          </ButtonLink>
        </div>
      </form>
    </Card>
  );
}

export function EditCasePage() {
  const { id = '' } = useParams();
  const legalCase = useCase(id);

  if (legalCase.isPending) return <Spinner label="Loading case…" />;
  if (legalCase.isError) return <Alert>{errorMessage(legalCase.error)}</Alert>;

  return (
    <div className="space-y-4">
      <Link to={`/cases/${id}`} className="text-sm text-indigo-700 hover:underline">
        ← Back to case
      </Link>
      <h1 className="text-2xl font-semibold text-slate-900">Edit {legalCase.data.title}</h1>
      <EditCaseForm legalCase={legalCase.data} />
    </div>
  );
}
