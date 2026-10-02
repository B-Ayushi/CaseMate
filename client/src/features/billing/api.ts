import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/http';

export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PAID';
export type InvoiceDisplayStatus = InvoiceStatus | 'OVERDUE';

export const invoiceStatusLabels: Record<InvoiceDisplayStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
};

export interface TimeEntry {
  id: string;
  workDate: string; // "yyyy-MM-dd" (IST day)
  minutes: number;
  description: string;
  ratePaise: number;
  amountPaise: number;
  hearingId: string | null;
  case: { id: string; title: string; caseNumber: string; client: { id: string; name: string } };
  invoice: {
    id: string;
    number: string;
    status: InvoiceStatus;
    displayStatus: InvoiceDisplayStatus;
  } | null;
}

export interface Invoice {
  id: string;
  number: string;
  issueDate: string;
  dueDate: string;
  totalPaise: number;
  status: InvoiceStatus;
  displayStatus: InvoiceDisplayStatus;
  sentAt: string | null;
  paidAt: string | null;
  notes: string | null;
  entryCount: number;
  client: { id: string; name: string; email: string | null };
}

export interface BillingSummary {
  month: string;
  billed: { paise: number; invoices: number };
  received: { paise: number; invoices: number };
  outstanding: { paise: number; invoices: number; overduePaise: number };
  unbilled: { paise: number; minutes: number; entries: number };
}

export interface TimeEntryFilter {
  caseId?: string;
  clientId?: string;
  billed?: 'all' | 'billed' | 'unbilled';
}

export const billingKeys = {
  all: ['billing'] as const,
  entries: (filter: TimeEntryFilter) => ['billing', 'entries', filter] as const,
  rate: (caseId: string) => ['billing', 'rate', caseId] as const,
  invoices: ['billing', 'invoices'] as const,
  summary: (month: string) => ['billing', 'summary', month] as const,
  settings: ['billing', 'settings'] as const,
};

// Time and invoices show up on cases, clients and the dashboard too.
function useInvalidateBilling() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      [billingKeys.all, ['cases'], ['clients'], ['dashboard']].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
}

export function useTimeEntries(filter: TimeEntryFilter) {
  return useQuery({
    queryKey: billingKeys.entries(filter),
    queryFn: () => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filter)) if (value) params.set(key, value);
      return api
        .get<{ timeEntries: TimeEntry[] }>(`/time-entries?${params}`)
        .then((r) => r.timeEntries);
    },
  });
}

export function useRate(caseId: string) {
  return useQuery({
    queryKey: billingKeys.rate(caseId),
    queryFn: () =>
      api
        .get<{
          rate: { ratePaise: number; source: 'client' | 'default'; clientName: string };
        }>(`/time-entries/rate?caseId=${caseId}`)
        .then((r) => r.rate),
    enabled: caseId !== '',
  });
}

export interface TimeEntryBody {
  workDate: string;
  minutes: number;
  description: string;
}

export function useSaveTimeEntry() {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: ({ id, caseId, body }: { id?: string; caseId: string; body: TimeEntryBody }) =>
      id
        ? api.put<{ timeEntry: TimeEntry }>(`/time-entries/${id}`, body)
        : api.post<{ timeEntry: TimeEntry }>('/time-entries', { caseId, ...body }),
    onSuccess: invalidate,
  });
}

export function useDeleteTimeEntry() {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/time-entries/${id}`),
    onSuccess: invalidate,
  });
}

export function useInvoices() {
  return useQuery({
    queryKey: billingKeys.invoices,
    queryFn: () => api.get<{ invoices: Invoice[] }>('/invoices').then((r) => r.invoices),
  });
}

export function useCreateInvoice() {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: (body: {
      clientId: string;
      timeEntryIds: string[];
      issueDate: string;
      dueDate: string;
      notes: string | null;
    }) => api.post<{ invoice: Invoice }>('/invoices', body).then((r) => r.invoice),
    onSuccess: invalidate,
  });
}

export function useUpdateInvoice() {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: ({ id, dueDate, notes }: { id: string; dueDate: string; notes: string | null }) =>
      api.patch<{ invoice: Invoice }>(`/invoices/${id}`, { dueDate, notes }),
    onSuccess: invalidate,
  });
}

// One mutation per invoice action, so each row shows its own progress and errors.
export function useInvoiceAction() {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: async ({
      id,
      action,
    }: {
      id: string;
      action: 'send' | 'mark-sent' | 'mark-paid' | 'delete';
    }) => {
      if (action === 'delete') await api.delete(`/invoices/${id}`);
      else await api.post<{ invoice: Invoice }>(`/invoices/${id}/${action}`);
    },
    onSettled: invalidate,
  });
}

export function useBillingSummary(month: string) {
  return useQuery({
    queryKey: billingKeys.summary(month),
    queryFn: () =>
      api
        .get<{ summary: BillingSummary }>(`/billing/summary?month=${month}`)
        .then((r) => r.summary),
  });
}

export function useBillingSettings() {
  return useQuery({
    queryKey: billingKeys.settings,
    queryFn: () =>
      api
        .get<{ billing: { defaultHourlyRatePaise: number } }>('/settings/billing')
        .then((r) => r.billing),
  });
}

export function useUpdateBillingSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { defaultHourlyRatePaise: number }) =>
      api
        .patch<{ billing: { defaultHourlyRatePaise: number } }>('/settings/billing', body)
        .then((r) => r.billing),
    onSuccess: (billing) => {
      queryClient.setQueryData(billingKeys.settings, billing);
      // Rate previews for new time change with the default.
      void queryClient.invalidateQueries({ queryKey: ['billing', 'rate'] });
    },
  });
}

// Saves the invoice PDF through the browser's normal download.
export async function downloadInvoicePdf(id: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/invoices/${id}/pdf`, { credentials: 'same-origin' });
  } catch {
    throw new ApiError(
      0,
      'Could not reach CaseMate. Check your internet connection and try again.',
    );
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Download failed (HTTP ${res.status}).`);
  }
  const filename =
    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'invoice.pdf';
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// "1 h 30 min"
export function formatMinutes(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return [h ? `${h} h` : null, m || !h ? `${m} min` : null].filter(Boolean).join(' ');
}

// The same rounding as the server: rate × minutes / 60, to the nearest paisa.
export const amountForMinutes = (minutes: number, ratePaise: number) =>
  Math.round((minutes * ratePaise) / 60);
