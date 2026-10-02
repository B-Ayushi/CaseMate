import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/http';
import { Alert, Badge, Button, ButtonLink, Card, Spinner, TextLink } from '../../components/ui';
import {
  channelLabels,
  outcomeLabels,
  reminderTypeLabels,
  useCancelHearing,
  useCase,
  useDeleteCase,
  type CaseDetail,
  type Hearing,
  type HearingReminder,
} from '../../features/cases/api';
import { useNow } from '../../hooks/useNow';
import { formatDateTime, formatDay, formatTime, toDateInput } from '../../lib/dates';
import { cx } from '../../lib/cx';
import { CaseTimeTab } from './CaseTimeTab';
import { EditOutcomeForm, HearingSlotFormCard, OutcomeFormCard } from './HearingForms';

function formatMinutes(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return [h ? `${h} h` : null, m || !h ? `${m} min` : null].filter(Boolean).join(' ');
}

function ReminderStatus({ reminder }: { reminder: HearingReminder }) {
  switch (reminder.status) {
    case 'SENT':
      return <Badge tone="green">Sent</Badge>;
    case 'FAILED':
      return <Badge tone="red">Failed</Badge>;
    case 'SENDING':
      return <Badge tone="blue">Sending</Badge>;
    default:
      return reminder.attempts > 0 ? (
        <Badge tone="amber">Retrying</Badge>
      ) : (
        <Badge>Scheduled</Badge>
      );
  }
}

function ReminderList({ reminders }: { reminders: HearingReminder[] }) {
  if (reminders.length === 0) {
    return (
      <p className="text-sm text-slate-600">No reminders for this hearing (check your settings).</p>
    );
  }
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {reminders.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span>
            <span className="font-medium text-slate-900">{reminderTypeLabels[r.type]}</span>
            <span className="text-slate-600">
              {' '}
              · {channelLabels[r.channel]} · {formatDateTime(r.sentAt ?? r.sendAt)}
            </span>
            {r.lastError && <span className="block text-xs text-red-700">{r.lastError}</span>}
          </span>
          <ReminderStatus reminder={r} />
        </li>
      ))}
    </ul>
  );
}

function NextHearingCard({ legalCase, hearing }: { legalCase: CaseDetail; hearing: Hearing }) {
  const [editing, setEditing] = useState(false);
  const cancelHearing = useCancelHearing();

  return (
    <Card
      title="Next hearing"
      className="border-indigo-200 ring-1 ring-indigo-100"
      actions={
        !editing && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Change date
            </Button>
            <Button
              variant="ghost"
              disabled={cancelHearing.isPending}
              onClick={() => {
                if (window.confirm('Cancel this hearing? Its reminders will not be sent.')) {
                  cancelHearing.mutate(hearing.id);
                }
              }}
            >
              Cancel hearing
            </Button>
          </div>
        )
      }
    >
      {cancelHearing.isError && (
        <div className="mb-3">
          <Alert>{errorMessage(cancelHearing.error)}</Alert>
        </div>
      )}
      {editing ? (
        <HearingSlotFormCard
          caseId={legalCase.id}
          hearing={hearing}
          submitLabel="Save new date"
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-xl font-semibold text-slate-900">{formatDay(hearing.scheduledAt)}</p>
            <p className="text-slate-700">
              {formatTime(hearing.scheduledAt)} · {legalCase.courtName}
              {legalCase.courtroom && `, ${legalCase.courtroom}`}
            </p>
            {hearing.purpose && (
              <p className="mt-1 text-sm text-slate-700">Purpose: {hearing.purpose}</p>
            )}
            {hearing.notes && (
              <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                Note: {hearing.notes}
              </p>
            )}
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-slate-900">Reminders</h3>
            <ReminderList reminders={hearing.reminders} />
          </div>
        </div>
      )}
    </Card>
  );
}

function HearingHistory({ hearings, caseId }: { hearings: Hearing[]; caseId: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (hearings.length === 0) return <p className="text-sm text-slate-600">No earlier hearings.</p>;
  return (
    <ol className="space-y-3">
      {hearings.map((h) => (
        <li key={h.id} className="rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-slate-900">{formatDateTime(h.scheduledAt)}</p>
            {h.status === 'CANCELLED' ? (
              <Badge>Cancelled</Badge>
            ) : h.outcome ? (
              <Badge tone={h.outcome === 'DISPOSED' ? 'green' : 'blue'}>
                {outcomeLabels[h.outcome]}
              </Badge>
            ) : (
              <Badge tone="amber">Outcome not logged</Badge>
            )}
          </div>
          {h.purpose && <p className="text-sm text-slate-600">Purpose: {h.purpose}</p>}
          {h.outcomeNotes && (
            <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{h.outcomeNotes}</p>
          )}
          {h.timeSpentMinutes ? (
            <p className="mt-1 text-xs text-slate-600">
              Time spent: {formatMinutes(h.timeSpentMinutes)}
            </p>
          ) : null}
          {h.status === 'COMPLETED' &&
            (editing === h.id ? (
              <EditOutcomeForm hearing={h} caseId={caseId} onDone={() => setEditing(null)} />
            ) : (
              <Button
                variant="ghost"
                className="mt-1 px-2 py-1 text-xs"
                onClick={() => setEditing(h.id)}
              >
                Edit outcome<span className="sr-only"> of {formatDateTime(h.scheduledAt)}</span>
              </Button>
            ))}
        </li>
      ))}
    </ol>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-sm text-slate-900">{value}</dd>
    </div>
  );
}

type CaseTab = 'hearings' | 'time';
const TABS: { id: CaseTab; label: string }[] = [
  { id: 'hearings', label: 'Hearings' },
  { id: 'time', label: 'Time and billing' },
];

// Tabs: the selected one is in the address (?tab=time) so it survives a reload and can be
// linked to. Arrow keys move between tabs.
function CaseTabs({ selected, onSelect }: { selected: CaseTab; onSelect: (tab: CaseTab) => void }) {
  return (
    <div role="tablist" aria-label="Case sections" className="flex gap-1 border-b border-slate-200">
      {TABS.map((tab, i) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={selected === tab.id}
          aria-controls={`panel-${tab.id}`}
          tabIndex={selected === tab.id ? 0 : -1}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
            event.preventDefault();
            const next =
              TABS[(i + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!;
            onSelect(next.id);
            document.getElementById(`tab-${next.id}`)?.focus();
          }}
          className={cx(
            '-mb-px border-b-2 px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-indigo-600',
            selected === tab.id
              ? 'border-indigo-700 text-indigo-800'
              : 'border-transparent text-slate-600 hover:text-slate-900',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function CasePage() {
  const { id = '' } = useParams();
  const legalCase = useCase(id);
  const deleteCase = useDeleteCase();
  const navigate = useNavigate();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const now = useNow();
  const { hash } = useLocation();
  const loaded = legalCase.isSuccess;
  const [params, setParams] = useSearchParams();
  const tab: CaseTab = params.get('tab') === 'time' ? 'time' : 'hearings';
  const selectTab = (next: CaseTab) =>
    setParams(next === 'time' ? { tab: 'time' } : {}, { replace: true });

  // Links such as "Add next date" on the dashboard point at one hearing's outcome card
  // (#outcome-<hearing id>): bring it into view and put the cursor in its first field.
  // This waits a tick so it runs after the app shell moves focus to the new page.
  useEffect(() => {
    if (!loaded || !hash.startsWith('#outcome-')) return;
    const timer = window.setTimeout(() => {
      const card = document.getElementById(hash.slice(1));
      if (!card) return;
      card.scrollIntoView({ block: 'start' });
      card.querySelector<HTMLElement>('select, input, textarea')?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loaded, hash]);

  if (legalCase.isPending) return <Spinner label="Loading case…" />;
  if (legalCase.isError) {
    const notFound = legalCase.error instanceof ApiError && legalCase.error.status === 404;
    return (
      <Alert>
        {notFound ? 'This case does not exist or has been deleted.' : errorMessage(legalCase.error)}{' '}
        <TextLink to="/cases">Back to cases</TextLink>
      </Alert>
    );
  }

  const c = legalCase.data;
  const today = toDateInput(new Date(now));
  const scheduled = c.hearings
    .filter((h) => h.status === 'SCHEDULED')
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  const next = scheduled.find((h) => Date.parse(h.scheduledAt) > now);
  const awaitingOutcome = scheduled.filter((h) => toDateInput(h.scheduledAt) <= today);
  const history = c.hearings.filter((h) => h.id !== next?.id && !awaitingOutcome.includes(h));

  async function onDelete() {
    if (!window.confirm(`Delete ${c.title}? Its hearings and reminders are deleted too.`)) return;
    setDeleteError(null);
    try {
      await deleteCase.mutateAsync(c.id);
      navigate('/cases', { replace: true });
    } catch (error) {
      setDeleteError(errorMessage(error));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/cases" className="text-sm text-indigo-700 hover:underline">
          ← All cases
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {c.title} {c.status === 'CLOSED' && <Badge>Closed</Badge>}
            </h1>
            <p className="text-sm text-slate-600">
              {c.caseNumber} · <TextLink to={`/clients/${c.client.id}`}>{c.client.name}</TextLink>
            </p>
          </div>
          <div className="flex gap-2">
            <ButtonLink to={`/cases/${c.id}/edit`} variant="secondary">
              Edit case
            </ButtonLink>
            <Button variant="ghost" onClick={onDelete} disabled={deleteCase.isPending}>
              Delete
            </Button>
          </div>
        </div>
      </div>
      {deleteError && <Alert>{deleteError}</Alert>}

      <CaseTabs selected={tab} onSelect={selectTab} />

      {tab === 'time' ? (
        <div role="tabpanel" id="panel-time" aria-labelledby="tab-time">
          <CaseTimeTab legalCase={c} />
        </div>
      ) : (
        <div
          role="tabpanel"
          id="panel-hearings"
          aria-labelledby="tab-hearings"
          className="space-y-6"
        >
          {awaitingOutcome.map((h) => (
            <Card
              key={h.id}
              id={`outcome-${h.id}`}
              title={`Log the outcome of ${formatDay(h.scheduledAt)}, ${formatTime(h.scheduledAt)}`}
              className="border-amber-200 ring-1 ring-amber-100"
            >
              <OutcomeFormCard hearing={h} />
            </Card>
          ))}

          {next ? (
            <NextHearingCard legalCase={c} hearing={next} />
          ) : c.status === 'ACTIVE' && awaitingOutcome.length === 0 ? (
            <Card
              title="Schedule the next hearing"
              className="border-amber-200 ring-1 ring-amber-100"
            >
              <p className="mb-4 text-sm text-amber-900">This case has no upcoming hearing date.</p>
              <HearingSlotFormCard caseId={c.id} submitLabel="Schedule hearing" />
            </Card>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <Card title="Hearing history">
              <HearingHistory hearings={history} caseId={c.id} />
            </Card>
            <div className="space-y-6">
              <Card title="Details">
                <dl className="space-y-3">
                  <Fact
                    label="Court"
                    value={[c.courtName, c.courtroom].filter(Boolean).join(', ')}
                  />
                  <Fact label="Judge" value={c.judge} />
                  <Fact label="Case type" value={c.caseType} />
                  <Fact label="Opposing party" value={c.opposingParty} />
                  <Fact label="Opposing counsel" value={c.opposingCounsel} />
                  <Fact label="Notes" value={c.notes} />
                </dl>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
