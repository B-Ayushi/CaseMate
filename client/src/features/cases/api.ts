import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/http';

export type CaseStatus = 'ACTIVE' | 'CLOSED';
export type HearingStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
export type HearingOutcome = 'ADJOURNED' | 'HEARD' | 'ORDER_RESERVED' | 'DISPOSED' | 'OTHER';
export type ReminderType = 'DAY_BEFORE' | 'TWO_HOUR' | 'DAILY_SUMMARY' | 'MISSING_OUTCOME';
export type ReminderChannel = 'EMAIL' | 'SMS';
export type ReminderStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED';

export const outcomeLabels: Record<HearingOutcome, string> = {
  ADJOURNED: 'Adjourned',
  HEARD: 'Heard',
  ORDER_RESERVED: 'Order reserved',
  DISPOSED: 'Disposed',
  OTHER: 'Other',
};

export const reminderTypeLabels: Record<ReminderType, string> = {
  DAY_BEFORE: 'Day before',
  TWO_HOUR: '2 hours before',
  DAILY_SUMMARY: 'Daily summary',
  MISSING_OUTCOME: 'Outcome nudge',
};

export const channelLabels: Record<ReminderChannel, string> = { EMAIL: 'Email', SMS: 'SMS' };

export interface CaseListItem {
  id: string;
  title: string;
  caseNumber: string;
  caseType: string | null;
  courtName: string;
  courtroom: string | null;
  status: CaseStatus;
  client: { id: string; name: string };
  nextHearing: { id: string; scheduledAt: string; purpose: string | null } | null;
}

export interface HearingReminder {
  id: string;
  type: ReminderType;
  channel: ReminderChannel;
  sendAt: string;
  status: ReminderStatus;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
}

export interface Hearing {
  id: string;
  scheduledAt: string;
  purpose: string | null;
  notes: string | null;
  status: HearingStatus;
  outcome: HearingOutcome | null;
  outcomeNotes: string | null;
  timeSpentMinutes: number | null;
  loggedAt: string | null;
  reminders: HearingReminder[];
}

export interface CaseDetail {
  id: string;
  title: string;
  caseNumber: string;
  caseType: string | null;
  courtName: string;
  courtroom: string | null;
  judge: string | null;
  opposingParty: string | null;
  opposingCounsel: string | null;
  notes: string | null;
  status: CaseStatus;
  emailReminderOverride: boolean | null;
  smsReminderOverride: boolean | null;
  dayBeforeReminderOverride: boolean | null;
  twoHourReminderOverride: boolean | null;
  client: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    hourlyRatePaise: number | null;
  };
  hearings: Hearing[];
  time: {
    totalMinutes: number;
    totalPaise: number;
    unbilledMinutes: number;
    unbilledPaise: number;
  };
}

export interface HearingSlot {
  date: string;
  time: string;
  purpose: string | null;
  notes: string | null;
}

export interface CaseFields {
  clientId: string;
  title: string;
  caseNumber: string;
  caseType: string | null;
  courtName: string;
  courtroom: string | null;
  judge: string | null;
  opposingParty: string | null;
  opposingCounsel: string | null;
  notes: string | null;
  emailReminderOverride: boolean | null;
  smsReminderOverride: boolean | null;
  dayBeforeReminderOverride: boolean | null;
  twoHourReminderOverride: boolean | null;
}

export interface OutcomeBody {
  outcome: HearingOutcome;
  outcomeNotes: string | null;
  timeSpentMinutes: number | null;
  nextHearing: HearingSlot | null;
  closeCase: boolean;
}

export const caseKeys = {
  all: ['cases'] as const,
  list: (status: string, search: string) => ['cases', 'list', status, search] as const,
  detail: (id: string) => ['cases', 'detail', id] as const,
};

export function useCases(status: 'ACTIVE' | 'CLOSED' | 'ALL', search: string) {
  return useQuery({
    queryKey: caseKeys.list(status, search),
    queryFn: () => {
      const params = new URLSearchParams({ status });
      if (search) params.set('search', search);
      return api.get<{ cases: CaseListItem[] }>(`/cases?${params}`).then((r) => r.cases);
    },
    placeholderData: keepPreviousData,
  });
}

export function useCase(id: string) {
  return useQuery({
    queryKey: caseKeys.detail(id),
    queryFn: () => api.get<{ case: CaseDetail }>(`/cases/${id}`).then((r) => r.case),
  });
}

// Hearings, cases and clients show each other's data, so a change to one refreshes all.
function useInvalidateAll() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: caseKeys.all }),
      queryClient.invalidateQueries({ queryKey: ['clients'] }),
      queryClient.invalidateQueries({ queryKey: ['hearings'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['calendar'] }),
      queryClient.invalidateQueries({ queryKey: ['billing'] }),
    ]);
}

export function useCreateCase() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (body: CaseFields & { firstHearing: HearingSlot }) =>
      api.post<{ case: { id: string } }>('/cases', body).then((r) => r.case),
    onSuccess: invalidate,
  });
}

export function useUpdateCase(id: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (body: CaseFields & { status: CaseStatus }) =>
      api.put<{ case: { id: string } }>(`/cases/${id}`, body).then((r) => r.case),
    onSuccess: invalidate,
  });
}

export function useDeleteCase() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/cases/${id}`),
    onSuccess: invalidate,
  });
}

export function useAddHearing(caseId: string) {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (slot: HearingSlot) => api.post(`/cases/${caseId}/hearings`, slot),
    onSuccess: invalidate,
  });
}

export function useUpdateHearing() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, slot }: { id: string; slot: HearingSlot }) =>
      api.put(`/hearings/${id}`, slot),
    onSuccess: invalidate,
  });
}

export function useCancelHearing() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => api.post(`/hearings/${id}/cancel`),
    onSuccess: invalidate,
  });
}

export function useLogOutcome() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: OutcomeBody }) =>
      api.post(`/hearings/${id}/outcome`, body),
    onSuccess: invalidate,
  });
}

export function useEditOutcome() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: {
        outcome: HearingOutcome;
        outcomeNotes: string | null;
        timeSpentMinutes: number | null;
      };
    }) => api.put(`/hearings/${id}/outcome`, body),
    onSuccess: invalidate,
  });
}
