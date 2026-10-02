import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api/http';
import { Alert, Badge, Button, ButtonLink, Card, Spinner, TextLink } from '../components/ui';
import { useLawyer } from '../features/auth/api';
import { channelLabels, outcomeLabels, reminderTypeLabels } from '../features/cases/api';
import {
  useDashboard,
  useRetryReminder,
  type Dashboard,
  type FailedReminder,
  type HearingSummary,
} from '../features/dashboard/api';
import { useNow } from '../hooks/useNow';
import { cx } from '../lib/cx';
import { formatDateTime, formatIsoDay, formatIst, formatTime } from '../lib/dates';

function greeting(now: number) {
  const hour = Number(formatIst(new Date(now), 'H'));
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  hint: string;
  tone?: 'neutral' | 'amber';
}) {
  const labelId = useId();
  const alert = tone === 'amber' && value > 0;
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={cx(
        'rounded-xl border bg-white p-5 shadow-sm',
        alert ? 'border-amber-300 ring-1 ring-amber-100' : 'border-slate-200',
      )}
    >
      <p id={labelId} className="text-sm font-medium text-slate-600">
        {label}
      </p>
      <p className={cx('mt-1 text-3xl font-semibold', alert ? 'text-amber-800' : 'text-slate-900')}>
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-600">{hint}</p>
    </div>
  );
}

function PanelEmpty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
      {children}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

const court = (h: HearingSummary) =>
  [h.case.courtName, h.case.courtroom].filter(Boolean).join(', ');

function TodayHearings({ data, now }: { data: Dashboard; now: number }) {
  if (data.todayHearings.length === 0) {
    return data.hasCases ? (
      <PanelEmpty>No hearings today. The coming week is below.</PanelEmpty>
    ) : (
      <PanelEmpty action={<ButtonLink to="/cases/new">Add your first case</ButtonLink>}>
        <p className="font-medium text-slate-900">No cases yet</p>
        <p className="mt-1">
          Add a case with its next hearing and it will show up here on the day.
        </p>
      </PanelEmpty>
    );
  }
  return (
    <ul className="divide-y divide-slate-100">
      {data.todayHearings.map((h) => {
        const passed = h.status === 'SCHEDULED' && Date.parse(h.scheduledAt) <= now;
        return (
          <li key={h.id}>
            <Link
              to={`/cases/${h.case.id}`}
              className="-mx-2 flex gap-4 rounded-lg px-2 py-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-indigo-600"
            >
              <span className="w-20 shrink-0 font-semibold text-slate-900">
                {formatTime(h.scheduledAt)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-indigo-800">{h.case.title}</span>
                <span className="block text-sm text-slate-600">
                  {h.case.caseNumber} · {court(h)}
                </span>
                <span className="block text-sm text-slate-600">Client: {h.case.client.name}</span>
              </span>
              <span className="shrink-0 self-center">
                {h.outcome ? (
                  <Badge tone="green">{outcomeLabels[h.outcome]}</Badge>
                ) : passed ? (
                  <Badge tone="amber">Outcome not logged</Badge>
                ) : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function FailedReminderItem({ reminder }: { reminder: FailedReminder }) {
  const retry = useRetryReminder();
  const what =
    reminder.type === 'DAILY_SUMMARY'
      ? `Daily summary email${reminder.summaryDate ? ` for ${formatIsoDay(reminder.summaryDate, 'd MMM')}` : ''}`
      : `${reminderTypeLabels[reminder.type]} ${channelLabels[reminder.channel]}`;

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">
            <Badge tone="red">Not sent</Badge> {what}
            {reminder.case && (
              <>
                {' '}
                for <TextLink to={`/cases/${reminder.case.id}`}>{reminder.case.title}</TextLink>
              </>
            )}
          </p>
          <p className="mt-1 text-sm text-red-800">{reminder.reason}</p>
          {!reminder.canRetry && reminder.retryBlockedReason && (
            <p className="mt-1 text-xs text-slate-600">
              Can't retry: {reminder.retryBlockedReason}
            </p>
          )}
          {reminder.detail && (
            <details className="mt-1 text-xs text-slate-600">
              <summary className="cursor-pointer">Technical details</summary>
              <p className="mt-1 break-words">{reminder.detail}</p>
            </details>
          )}
        </div>
        {reminder.canRetry && (
          <Button
            variant="secondary"
            className="px-3 py-1.5"
            disabled={retry.isPending}
            onClick={() => retry.mutate(reminder.id)}
            aria-label={`Retry ${what}${reminder.case ? ` for ${reminder.case.title}` : ''}`}
          >
            {retry.isPending ? 'Retrying…' : 'Retry'}
          </Button>
        )}
      </div>
      {retry.isError && (
        <div className="mt-2">
          <Alert>{errorMessage(retry.error)}</Alert>
        </div>
      )}
    </li>
  );
}

function NeedsAttention({ data }: { data: Dashboard }) {
  const { missingOutcome, failedReminders } = data.needsAttention;
  if (missingOutcome.length === 0 && failedReminders.length === 0) {
    return (
      <PanelEmpty>
        <p className="font-medium text-slate-900">All clear</p>
        <p className="mt-1">
          Hearings that need a next date and reminders that could not be sent will show here.
        </p>
      </PanelEmpty>
    );
  }
  return (
    <ul className="divide-y divide-slate-100">
      {missingOutcome.map((h) => (
        <li key={h.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-900">
              <Badge tone="amber">Next date missing</Badge>{' '}
              <TextLink to={`/cases/${h.case.id}`}>{h.case.title}</TextLink>
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Hearing on {formatDateTime(h.scheduledAt)} has no outcome logged.
            </p>
          </div>
          <ButtonLink
            to={`/cases/${h.case.id}#outcome-${h.id}`}
            variant="secondary"
            className="px-3 py-1.5"
            aria-label={`Add next date for ${h.case.title}`}
          >
            Add next date
          </ButtonLink>
        </li>
      ))}
      {failedReminders.map((r) => (
        <FailedReminderItem key={r.id} reminder={r} />
      ))}
    </ul>
  );
}

function ComingUp({ data }: { data: Dashboard }) {
  const { days, total } = data.next7Days;
  return (
    <>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {days.map((d) => (
          <li key={d.date}>
            <Link
              to={`/calendar?month=${d.date.slice(0, 7)}&day=${d.date}`}
              aria-label={`${formatIsoDay(d.date, 'EEEE d MMMM')}: ${d.count} ${d.count === 1 ? 'hearing' : 'hearings'}`}
              className={cx(
                'block rounded-lg border p-3 text-center hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-indigo-600',
                d.count > 0 ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-200',
              )}
            >
              <span className="block text-xs font-medium uppercase tracking-wide text-slate-600">
                {formatIsoDay(d.date, 'EEE')}
              </span>
              <span className="block text-sm text-slate-900">{formatIsoDay(d.date, 'd MMM')}</span>
              <span
                className={cx(
                  'mt-1 block text-2xl font-semibold',
                  d.count > 0 ? 'text-indigo-800' : 'text-slate-400',
                )}
              >
                {d.count}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {total === 0 && (
        <p className="mt-3 text-sm text-slate-600">
          {data.hasCases
            ? 'No hearings in the next 7 days.'
            : 'Once you add cases, the coming week’s hearings are counted here.'}
        </p>
      )}
    </>
  );
}

export function DashboardPage() {
  const lawyer = useLawyer();
  const dashboard = useDashboard();
  const now = useNow();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {greeting(now)}, {lawyer.name}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {formatIst(new Date(now), 'EEEE, d MMMM yyyy')}
          </p>
        </div>
        <ButtonLink to="/cases/new">+ Add new case</ButtonLink>
      </div>

      {dashboard.isPending ? (
        <Spinner label="Loading your dashboard…" />
      ) : dashboard.isError ? (
        <Alert>
          {errorMessage(dashboard.error)}{' '}
          <button
            type="button"
            onClick={() => void dashboard.refetch()}
            className="font-medium underline"
          >
            Try again
          </button>
        </Alert>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Hearings today"
              value={dashboard.data.counts.today}
              hint="In time order below"
            />
            <StatCard
              label="Next 7 days"
              value={dashboard.data.counts.next7Days}
              hint="From tomorrow, by day below"
            />
            <StatCard
              label="Need next date"
              value={dashboard.data.counts.needNextDate}
              hint="Hearings with no outcome logged"
              tone="amber"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
            <Card title="Today’s hearings">
              <TodayHearings data={dashboard.data} now={now} />
            </Card>
            <Card title="Needs attention">
              <NeedsAttention data={dashboard.data} />
            </Card>
          </div>

          <Card
            title="Coming up in the next 7 days"
            actions={<TextLink to="/calendar">Open calendar</TextLink>}
          >
            <ComingUp data={dashboard.data} />
          </Card>
        </>
      )}
    </div>
  );
}
