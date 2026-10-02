import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/http';
import {
  caseKeys,
  type HearingOutcome,
  type HearingStatus,
  type ReminderChannel,
  type ReminderType,
} from '../cases/api';

export interface HearingSummary {
  id: string;
  scheduledAt: string;
  purpose: string | null;
  status: HearingStatus;
  outcome: HearingOutcome | null;
  case: {
    id: string;
    title: string;
    caseNumber: string;
    courtName: string;
    courtroom: string | null;
    client: { id: string; name: string };
  };
}

export interface FailedReminder {
  id: string;
  type: ReminderType;
  channel: ReminderChannel;
  failedAt: string;
  reason: string;
  detail: string | null;
  summaryDate: string | null;
  hearing: { id: string; scheduledAt: string } | null;
  case: { id: string; title: string; caseNumber: string } | null;
  canRetry: boolean;
  retryBlockedReason: string | null;
}

export interface OverdueInvoice {
  id: string;
  number: string;
  totalPaise: number;
  dueDate: string; // "yyyy-MM-dd"
  daysOverdue: number;
  client: { id: string; name: string };
}

export interface Dashboard {
  today: string;
  hasCases: boolean;
  counts: {
    today: number;
    next7Days: number;
    needNextDate: number;
    unpaidInvoices: number;
    unpaidPaise: number;
  };
  todayHearings: HearingSummary[];
  next7Days: { total: number; days: { date: string; count: number }[] };
  needsAttention: {
    missingOutcome: HearingSummary[];
    failedReminders: FailedReminder[];
    overdueInvoices: OverdueInvoice[];
  };
}

export interface CalendarHearing extends HearingSummary {
  date: string; // "yyyy-MM-dd" in IST
  time: string; // "HH:mm" in IST
}

export const dashboardKey = ['dashboard'] as const;
export const calendarKey = (month: string) => ['calendar', month] as const;

export function useDashboard() {
  return useQuery({
    queryKey: dashboardKey,
    queryFn: () => api.get<Dashboard>('/dashboard'),
    // Keeps "today" and the overdue list current while the page is left open.
    refetchInterval: 60_000,
  });
}

export function useCalendar(month: string) {
  return useQuery({
    queryKey: calendarKey(month),
    queryFn: () =>
      api
        .get<{ month: string; hearings: CalendarHearing[] }>(`/calendar?month=${month}`)
        .then((r) => r.hearings),
  });
}

export function useRetryReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/reminders/${id}/retry`),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardKey }),
        queryClient.invalidateQueries({ queryKey: caseKeys.all }),
      ]),
  });
}
