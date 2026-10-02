import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/http';
import { SESSION_KEY, type Lawyer } from '../auth/api';
import type { ChangePasswordForm, ProfileForm, ReminderPrefsForm } from '../../lib/validation';

export interface Profile {
  id: string;
  name: string;
  email: string;
  phone: string;
  barCouncilNumber: string;
}

export type ReminderPrefs = ReminderPrefsForm;

export type TestResult =
  { status: 'sent'; to: string } | { status: 'failed'; to: string; reason: string };

export const settingsKeys = {
  profile: ['settings', 'profile'] as const,
  reminders: ['settings', 'reminders'] as const,
};

// The sidebar and dashboard read the lawyer from the session, so keep it in step.
function useUpdateSession() {
  const queryClient = useQueryClient();
  return (changes: Partial<Lawyer>) =>
    queryClient.setQueryData<Lawyer | null>(SESSION_KEY, (old) =>
      old ? { ...old, ...changes } : old,
    );
}

export function useProfile() {
  return useQuery({
    queryKey: settingsKeys.profile,
    queryFn: () => api.get<{ profile: Profile }>('/settings/profile').then((r) => r.profile),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const updateSession = useUpdateSession();
  return useMutation({
    mutationFn: (body: ProfileForm) =>
      api.patch<{ profile: Profile }>('/settings/profile', body).then((r) => r.profile),
    onSuccess: (profile) => {
      queryClient.setQueryData(settingsKeys.profile, profile);
      updateSession(profile);
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: Omit<ChangePasswordForm, 'confirmPassword'>) =>
      api.post<{ message: string }>('/settings/password', body),
  });
}

export function useReminderPrefs() {
  return useQuery({
    queryKey: settingsKeys.reminders,
    queryFn: () =>
      api.get<{ preferences: ReminderPrefs }>('/settings/reminders').then((r) => r.preferences),
  });
}

export function useUpdateReminderPrefs() {
  const queryClient = useQueryClient();
  const updateSession = useUpdateSession();
  return useMutation({
    mutationFn: (body: ReminderPrefs) =>
      api.patch<{ preferences: ReminderPrefs; upcomingHearings: number }>(
        '/settings/reminders',
        body,
      ),
    onSuccess: async ({ preferences }) => {
      queryClient.setQueryData(settingsKeys.reminders, preferences);
      updateSession(preferences);
      // Case pages list each hearing's reminders, which were just rebuilt.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cases'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
    },
  });
}

export function useTestReminder() {
  return useMutation({
    mutationFn: () => api.post<{ email: TestResult; sms: TestResult }>('/settings/test-reminder'),
  });
}

// Downloads the export through the browser's normal "save file" flow.
export async function downloadMyData(): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/settings/export', { credentials: 'same-origin' });
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
    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ??
    'casemate-data.json';
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api.delete<{ message: string }>('/settings/account', body),
  });
}
