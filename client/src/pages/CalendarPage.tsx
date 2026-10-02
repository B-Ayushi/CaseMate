import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/http';
import { Alert, Badge, Button, Card, PageHeader, Spinner } from '../components/ui';
import { outcomeLabels } from '../features/cases/api';
import { useCalendar, type CalendarHearing } from '../features/dashboard/api';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useNow } from '../hooks/useNow';
import { cx } from '../lib/cx';
import {
  addDaysToIsoDay,
  addMonths,
  daysOfMonth,
  formatIsoDay,
  formatIst,
  formatMonth,
  formatTime,
  isIsoDay,
  isMonth,
  weekdayMondayFirst,
} from '../lib/dates';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const hearingCount = (n: number) => `${n} ${n === 1 ? 'hearing' : 'hearings'}`;

function HearingRows({ hearings }: { hearings: CalendarHearing[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {hearings.map((h) => (
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
                {h.case.caseNumber} ·{' '}
                {[h.case.courtName, h.case.courtroom].filter(Boolean).join(', ')}
              </span>
              <span className="block text-sm text-slate-600">Client: {h.case.client.name}</span>
            </span>
            {h.outcome && (
              <span className="shrink-0 self-center">
                <Badge tone="green">{outcomeLabels[h.outcome]}</Badge>
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

const ARROW_STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

// The month as a grid of weeks (Monday first). One day button is in the tab order at a
// time; arrow keys move between days.
function MonthGrid({
  month,
  today,
  selected,
  counts,
  onSelect,
}: {
  month: string;
  today: string;
  selected: string | null;
  counts: Map<string, number>;
  onSelect: (day: string) => void;
}) {
  const days = daysOfMonth(month);
  const cells: (string | null)[] = [
    ...Array<null>(weekdayMondayFirst(days[0]!)).fill(null),
    ...days,
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  const focusable = selected ?? (today.startsWith(month) ? today : days[0]!);
  const tableRef = useRef<HTMLTableElement>(null);
  const moveFocus = useRef(false);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    tableRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusable}"]`)?.focus();
  }, [focusable]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    const step = ARROW_STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = addDaysToIsoDay(day, step);
    if (!next.startsWith(month)) return;
    moveFocus.current = true;
    onSelect(next);
  }

  return (
    <table ref={tableRef} className="w-full table-fixed border-collapse">
      <caption className="sr-only">
        Hearings in {formatMonth(month)}. Use the arrow keys to move between days.
      </caption>
      <thead>
        <tr>
          {WEEKDAYS.map((name) => (
            <th
              key={name}
              scope="col"
              abbr={name}
              className="pb-2 text-xs font-medium uppercase tracking-wide text-slate-600"
            >
              {name.slice(0, 3)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, i) => (
          <tr key={i}>
            {week.map((day, j) => {
              if (!day) return <td key={`empty-${j}`} className="p-1" />;
              const count = counts.get(day) ?? 0;
              const isToday = day === today;
              const isSelected = day === selected;
              return (
                <td key={day} className="p-1">
                  <button
                    type="button"
                    data-day={day}
                    tabIndex={day === focusable ? 0 : -1}
                    aria-pressed={isSelected}
                    aria-current={isToday ? 'date' : undefined}
                    aria-label={`${formatIsoDay(day, 'EEEE d MMMM')}${isToday ? ', today' : ''}: ${count ? hearingCount(count) : 'no hearings'}`}
                    onClick={() => onSelect(day)}
                    onKeyDown={(event) => onKeyDown(event, day)}
                    className={cx(
                      'flex h-20 w-full flex-col items-start justify-between rounded-lg border p-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
                      isSelected
                        ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600'
                        : 'border-slate-200 bg-white hover:bg-slate-50',
                    )}
                  >
                    <span
                      className={cx(
                        'flex h-7 w-7 items-center justify-center rounded-full text-sm',
                        isToday ? 'bg-indigo-700 font-semibold text-white' : 'text-slate-800',
                      )}
                    >
                      {Number(day.slice(8))}
                    </span>
                    {count > 0 && (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-900">
                        {hearingCount(count)}
                      </span>
                    )}
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Small screens: the month's hearings as a list, one group per day that has any.
function MonthList({
  month,
  today,
  byDay,
}: {
  month: string;
  today: string;
  byDay: Map<string, CalendarHearing[]>;
}) {
  const days = [...byDay.keys()].sort();
  if (days.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">
        No hearings in {formatMonth(month)}.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {days.map((day) => (
        <Card
          key={day}
          title={
            <span className="flex items-center gap-2">
              {formatIsoDay(day, 'EEE, d MMM yyyy')}
              {day === today && <Badge tone="blue">Today</Badge>}
            </span>
          }
          className={day === today ? 'border-indigo-300 ring-1 ring-indigo-100' : undefined}
        >
          <HearingRows hearings={byDay.get(day)!} />
        </Card>
      ))}
    </div>
  );
}

export function CalendarPage() {
  const now = useNow();
  const today = formatIst(new Date(now), 'yyyy-MM-dd');
  const [params, setParams] = useSearchParams();
  const monthParam = params.get('month');
  const month = isMonth(monthParam) ? monthParam : today.slice(0, 7);
  const dayParam = params.get('day');
  const selected =
    isIsoDay(dayParam) && dayParam.startsWith(month)
      ? dayParam
      : today.startsWith(month)
        ? today
        : null;
  const wide = useMediaQuery('(min-width: 768px)');
  const calendar = useCalendar(month);

  const byDay = new Map<string, CalendarHearing[]>();
  for (const h of calendar.data ?? []) {
    byDay.set(h.date, [...(byDay.get(h.date) ?? []), h]);
  }
  const counts = new Map([...byDay].map(([day, list]) => [day, list.length]));

  // Changing month adds a history entry; picking a day within the month replaces it, so
  // Back does not step through every day visited with the arrow keys.
  const show = (nextMonth: string, day?: string) =>
    setParams(day ? { month: nextMonth, day } : { month: nextMonth }, {
      replace: nextMonth === month && !!day,
    });

  return (
    <div>
      <PageHeader title="Calendar" description="Your hearings by day, in Indian Standard Time." />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900" aria-live="polite">
          {formatMonth(month)}
        </h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => show(addMonths(month, -1))}>
            <span aria-hidden="true">←</span> Previous<span className="sr-only"> month</span>
          </Button>
          <Button variant="secondary" onClick={() => show(today.slice(0, 7), today)}>
            Today
          </Button>
          <Button variant="secondary" onClick={() => show(addMonths(month, 1))}>
            Next<span className="sr-only"> month</span> <span aria-hidden="true">→</span>
          </Button>
        </div>
      </div>

      {calendar.isPending ? (
        <Spinner label={`Loading ${formatMonth(month)}…`} />
      ) : calendar.isError ? (
        <Alert>
          {errorMessage(calendar.error)}{' '}
          <button
            type="button"
            onClick={() => void calendar.refetch()}
            className="font-medium underline"
          >
            Try again
          </button>
        </Alert>
      ) : wide ? (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <MonthGrid
              month={month}
              today={today}
              selected={selected}
              counts={counts}
              onSelect={(day) => show(month, day)}
            />
          </div>
          {selected ? (
            <Card title={`Hearings on ${formatIsoDay(selected, 'EEEE, d MMMM yyyy')}`}>
              {byDay.get(selected)?.length ? (
                <HearingRows hearings={byDay.get(selected)!} />
              ) : (
                <p className="text-sm text-slate-600">No hearings on this day.</p>
              )}
            </Card>
          ) : (
            <p className="text-sm text-slate-600">Choose a day to see its hearings.</p>
          )}
        </div>
      ) : (
        <MonthList month={month} today={today} byDay={byDay} />
      )}
    </div>
  );
}
