import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/http';
import {
  Alert,
  Button,
  Card,
  PageHeader,
  SelectField,
  Spinner,
  TextField,
  ToggleField,
} from '../components/ui';
import { SESSION_KEY } from '../features/auth/api';
import {
  downloadMyData,
  useChangePassword,
  useDeleteAccount,
  useProfile,
  useReminderPrefs,
  useTestReminder,
  useUpdateProfile,
  useUpdateReminderPrefs,
  type Profile,
  type ReminderPrefs,
  type TestResult,
} from '../features/settings/api';
import { formatIst, istToUtc, todayIst } from '../lib/dates';
import { applyServerErrors } from '../lib/forms';
import {
  changePasswordFormSchema,
  deleteAccountFormSchema,
  profileFormSchema,
  reminderPrefsFormSchema,
  type ChangePasswordForm,
  type DeleteAccountForm,
  type ProfileForm,
  type ReminderPrefsForm,
} from '../lib/validation';

// "07:00" -> "7:00 AM"
const timeLabel = (time: string) => formatIst(istToUtc(todayIst(), time), 'h:mm a');

// Every quarter hour of the day, for the daily summary time.
const QUARTER_HOURS = Array.from({ length: 96 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, '0');
  const m = String((i % 4) * 15).padStart(2, '0');
  return `${h}:${m}`;
});

function SectionStatus({ error, success }: { error?: string | null; success?: string | null }) {
  if (error) return <Alert>{error}</Alert>;
  if (success) return <Alert tone="success">{success}</Alert>;
  return null;
}

function ProfileDetailsForm({ profile }: { profile: Profile }) {
  const update = useUpdateProfile();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      name: profile.name,
      phone: profile.phone,
      barCouncilNumber: profile.barCouncilNumber,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setSaved(false);
    try {
      const updated = await update.mutateAsync(values);
      // Show the number as stored (+91...).
      reset({
        name: updated.name,
        phone: updated.phone,
        barCouncilNumber: updated.barCouncilNumber,
      });
      setSaved(true);
    } catch (error) {
      setFormError(applyServerErrors(error, setError));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <SectionStatus error={formError} success={saved ? 'Profile saved.' : null} />
      <TextField
        label="Full name"
        autoComplete="name"
        required
        error={errors.name?.message}
        {...register('name')}
      />
      <TextField
        label="Email"
        type="email"
        value={profile.email}
        readOnly
        hint="You log in with this address and reminders are emailed to it. It can't be changed here."
        className="bg-slate-50 text-slate-700"
      />
      <TextField
        label="Mobile number"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        required
        hint="SMS reminders are sent to this number, for example 98765 43210"
        error={errors.phone?.message}
        {...register('phone')}
      />
      <TextField
        label="Bar Council enrolment number"
        required
        error={errors.barCouncilNumber?.message}
        {...register('barCouncilNumber')}
      />
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving…' : 'Save profile'}
      </Button>
    </form>
  );
}

function ProfileSection() {
  const profile = useProfile();
  return (
    <Card title="Profile">
      {profile.isPending ? (
        <Spinner label="Loading your profile…" />
      ) : profile.isError ? (
        <Alert>{errorMessage(profile.error)}</Alert>
      ) : (
        <ProfileDetailsForm profile={profile.data} />
      )}
    </Card>
  );
}

function PasswordSection() {
  const change = useChangePassword();
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordForm>({
    resolver: zodResolver(changePasswordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    setFormError(null);
    setDone(false);
    try {
      await change.mutateAsync({ currentPassword, newPassword });
      reset();
      setDone(true);
    } catch (error) {
      setFormError(applyServerErrors(error, setError));
    }
  });

  return (
    <Card title="Change password">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <SectionStatus
          error={formError}
          success={
            done
              ? 'Your password has been changed. You have been logged out on your other devices.'
              : null
          }
        />
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          error={errors.currentPassword?.message}
          {...register('currentPassword')}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 8 characters, with a letter and a number"
          error={errors.newPassword?.message}
          {...register('newPassword')}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Changing…' : 'Change password'}
        </Button>
      </form>
    </Card>
  );
}

function NeedsChannel({ show, channel }: { show: boolean; channel: string }) {
  if (!show) return null;
  return (
    <p className="mt-0.5 text-xs font-medium text-amber-800">
      {channel} is off above, so this reminder is not sent.
    </p>
  );
}

function ReminderForm({ prefs }: { prefs: ReminderPrefs }) {
  const update = useUpdateReminderPrefs();
  const [formError, setFormError] = useState<string | null>(null);
  const [savedFor, setSavedFor] = useState<number | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ReminderPrefsForm>({
    resolver: zodResolver(reminderPrefsFormSchema),
    defaultValues: prefs,
  });
  const values = useWatch({ control });
  const email = values.emailEnabled ?? prefs.emailEnabled;
  const sms = values.smsEnabled ?? prefs.smsEnabled;

  const onSubmit = handleSubmit(async (body) => {
    setFormError(null);
    setSavedFor(null);
    try {
      const { upcomingHearings } = await update.mutateAsync(body);
      setSavedFor(upcomingHearings);
    } catch (error) {
      setFormError(applyServerErrors(error, setError));
    }
  });

  const summaryTime = values.dailySummaryTime ?? prefs.dailySummaryTime;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <SectionStatus
        error={formError}
        success={
          savedFor === null
            ? null
            : `Updated reminders for ${savedFor} upcoming ${savedFor === 1 ? 'hearing' : 'hearings'}.`
        }
      />

      <fieldset>
        <legend className="text-sm font-semibold text-slate-900">How to reach you</legend>
        <div className="divide-y divide-slate-100">
          <ToggleField
            label="Email"
            description="Day-before reminders, the daily summary and the next-date nudge"
            {...register('emailEnabled')}
          />
          <ToggleField
            label="SMS"
            description="Day-before and 2-hour reminders, to the mobile number in your profile"
            {...register('smsEnabled')}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-slate-900">Which reminders</legend>
        <div className="divide-y divide-slate-100">
          <ToggleField
            label="Day-before reminder"
            description={
              <>
                24 hours before each hearing
                <NeedsChannel show={!email && !sms} channel="Email and SMS" />
              </>
            }
            {...register('dayBeforeEnabled')}
          />
          <ToggleField
            label="Final reminder"
            description={
              <>
                2 hours before each hearing
                <NeedsChannel show={!sms} channel="SMS" />
              </>
            }
            {...register('twoHourEnabled')}
          />
          <div>
            <ToggleField
              label="Daily summary"
              description={
                <>
                  Every morning with today’s hearings, at {timeLabel(summaryTime)}
                  <NeedsChannel show={!email} channel="Email" />
                </>
              }
              {...register('dailySummaryEnabled')}
            />
            {values.dailySummaryEnabled && (
              <div className="max-w-xs pb-3">
                <SelectField
                  label="Daily summary time (IST)"
                  error={errors.dailySummaryTime?.message}
                  {...register('dailySummaryTime')}
                >
                  {QUARTER_HOURS.map((time) => (
                    <option key={time} value={time}>
                      {timeLabel(time)}
                    </option>
                  ))}
                </SelectField>
              </div>
            )}
          </div>
          <ToggleField
            label="Missing next-date nudge"
            description={
              <>
                6 PM on a hearing day if no outcome is logged
                <NeedsChannel show={!email} channel="Email" />
              </>
            }
            {...register('missingOutcomeNudgeEnabled')}
          />
        </div>
      </fieldset>

      <p className="text-xs text-slate-600">
        Cases with their own reminder settings keep them. Reminders already sent are not affected.
      </p>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving…' : 'Save reminder settings'}
      </Button>
    </form>
  );
}

function TestResultLine({ label, result }: { label: string; result: TestResult }) {
  return (
    <li>
      <span className="font-medium text-slate-900">
        {label} to {result.to}:
      </span>{' '}
      {result.status === 'sent' ? (
        <span className="text-emerald-800">Sent. Check that it arrived.</span>
      ) : (
        <span className="text-red-800">{result.reason}</span>
      )}
    </li>
  );
}

function TestReminder() {
  const test = useTestReminder();
  return (
    <div className="space-y-3 border-t border-slate-200 pt-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Check delivery</h3>
        <p className="text-sm text-slate-600">
          Sends one email and one SMS to you right now, so you can see that reminders arrive.
        </p>
      </div>
      <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate()}>
        {test.isPending ? 'Sending…' : 'Send me a test reminder'}
      </Button>
      <div role="status" aria-live="polite">
        {test.isSuccess && (
          <ul className="space-y-1 text-sm">
            <TestResultLine label="Email" result={test.data.email} />
            <TestResultLine label="SMS" result={test.data.sms} />
          </ul>
        )}
      </div>
      {test.isError && <Alert>{errorMessage(test.error)}</Alert>}
    </div>
  );
}

function RemindersSection() {
  const prefs = useReminderPrefs();
  return (
    <Card title="Reminders">
      {prefs.isPending ? (
        <Spinner label="Loading your reminder settings…" />
      ) : prefs.isError ? (
        <Alert>{errorMessage(prefs.error)}</Alert>
      ) : (
        <div className="space-y-6">
          <ReminderForm prefs={prefs.data} />
          <TestReminder />
        </div>
      )}
    </Card>
  );
}

function DeleteAccountDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const deleteAccount = useDeleteAccount();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DeleteAccountForm>({
    resolver: zodResolver(deleteAccountFormSchema),
    defaultValues: { email: '', password: '' },
  });

  // Open as a modal (focus is kept inside and Escape closes it). Closing happens through
  // the dialog itself, which reports back through onClose; unmounting removes it.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await deleteAccount.mutateAsync(values);
      queryClient.clear();
      queryClient.setQueryData(SESSION_KEY, null);
      navigate('/login?deleted=1', { replace: true });
    } catch (error) {
      setFormError(applyServerErrors(error, setError));
    }
  });

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      className="w-[calc(100%-2rem)] max-w-lg rounded-xl border border-slate-200 p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4 p-6">
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          Delete your account?
        </h2>
        <div className="space-y-2 text-sm text-slate-700">
          <p>
            This permanently deletes your account and everything in it: clients, notes, cases,
            hearings, reminders, time entries and invoices.
          </p>
          <p className="font-medium text-red-800">This can’t be undone.</p>
          <p>If you want a copy, close this and use “Download my data” first.</p>
        </div>
        {formError && <Alert>{formError}</Alert>}
        <TextField
          label={`Type your email (${email}) to confirm`}
          type="email"
          autoComplete="off"
          required
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Your password"
          type="password"
          autoComplete="current-password"
          required
          error={errors.password?.message}
          {...register('password')}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={isSubmitting}>
            {isSubmitting ? 'Deleting…' : 'Delete my account permanently'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

function YourDataSection() {
  const profile = useProfile();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function download() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadMyData();
    } catch (error) {
      setDownloadError(errorMessage(error));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card title="Your data">
      <div className="space-y-6">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Download my data</h3>
          <p className="text-sm text-slate-600">
            A JSON file with your profile, clients, notes, cases, hearings, reminders, time entries
            and invoices.
          </p>
          {downloadError && <Alert>{downloadError}</Alert>}
          <Button variant="secondary" onClick={download} disabled={downloading}>
            {downloading ? 'Preparing…' : 'Download my data'}
          </Button>
        </div>
        <div className="space-y-2 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-semibold text-slate-900">Delete my account</h3>
          <p className="text-sm text-slate-600">
            Permanently removes your account and all of its data.
          </p>
          <Button variant="danger" onClick={() => setConfirming(true)} disabled={!profile.data}>
            Delete my account
          </Button>
        </div>
      </div>
      {confirming && profile.data && (
        <DeleteAccountDialog email={profile.data.email} onClose={() => setConfirming(false)} />
      )}
    </Card>
  );
}

export function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Your profile, password, reminders and data. All times are Indian Standard Time."
      />
      <div className="space-y-6">
        <ProfileSection />
        <PasswordSection />
        <RemindersSection />
        <YourDataSection />
      </div>
    </div>
  );
}
