import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/http';

export type PreferredContact = 'PHONE' | 'WHATSAPP' | 'EMAIL';

export const preferredContactLabels: Record<PreferredContact, string> = {
  PHONE: 'Phone call',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
};

export interface ClientSummary {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  preferredContact: PreferredContact;
  activeCaseCount: number;
  nextHearingAt: string | null;
}

export interface ClientNote {
  id: string;
  text: string;
  notedAt: string;
}

export interface ClientProfile {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  preferredContact: PreferredContact;
  languages: string | null;
  hourlyRatePaise: number | null;
  notes: ClientNote[];
  cases: {
    id: string;
    title: string;
    caseNumber: string;
    courtName: string;
    status: 'ACTIVE' | 'CLOSED';
    nextHearingAt: string | null;
  }[];
  billing: {
    billedPaise: number;
    paidPaise: number;
    duePaise: number;
    overduePaise: number;
    unbilledPaise: number;
  };
}

export interface ClientBody {
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  preferredContact: PreferredContact;
  languages: string | null;
  hourlyRatePaise: number | null;
}

export const clientKeys = {
  all: ['clients'] as const,
  list: (search: string) => ['clients', 'list', search] as const,
  detail: (id: string) => ['clients', 'detail', id] as const,
};

export function useClients(search = '') {
  return useQuery({
    queryKey: clientKeys.list(search),
    queryFn: () =>
      api
        .get<{ clients: ClientSummary[] }>(
          `/clients${search ? `?search=${encodeURIComponent(search)}` : ''}`,
        )
        .then((r) => r.clients),
    placeholderData: keepPreviousData,
  });
}

export function useClient(id: string) {
  return useQuery({
    queryKey: clientKeys.detail(id),
    queryFn: () => api.get<{ client: ClientProfile }>(`/clients/${id}`).then((r) => r.client),
  });
}

function useInvalidateClients() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: clientKeys.all });
}

export function useSaveClient(id?: string) {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (body: ClientBody) =>
      (id
        ? api.put<{ client: { id: string } }>(`/clients/${id}`, body)
        : api.post<{ client: { id: string } }>('/clients', body)
      ).then((r) => r.client),
    onSuccess: invalidate,
  });
}

export function useDeleteClient() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/clients/${id}`),
    onSuccess: invalidate,
  });
}

export function useAddClientNote(clientId: string) {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (body: { text: string }) => api.post(`/clients/${clientId}/notes`, body),
    onSuccess: invalidate,
  });
}

export function useDeleteClientNote(clientId: string) {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (noteId: string) => api.delete(`/clients/${clientId}/notes/${noteId}`),
    onSuccess: invalidate,
  });
}
