import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../api/http';

export interface Lawyer {
  id: string;
  name: string;
  email: string;
  phone: string;
  barCouncilNumber: string;
  defaultHourlyRatePaise: number;
  emailEnabled: boolean;
  smsEnabled: boolean;
  dayBeforeEnabled: boolean;
  twoHourEnabled: boolean;
  dailySummaryEnabled: boolean;
  dailySummaryTime: string;
  missingOutcomeNudgeEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export const SESSION_KEY = ['session'] as const;

// The logged-in lawyer, or null when nobody is logged in.
export async function fetchSession(): Promise<Lawyer | null> {
  try {
    const { lawyer } = await api.get<{ lawyer: Lawyer }>('/auth/me');
    return lawyer;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function useSession() {
  return useQuery({ queryKey: SESSION_KEY, queryFn: fetchSession, staleTime: 5 * 60 * 1000 });
}

// For pages behind RequireAuth, where the lawyer is always loaded.
export function useLawyer(): Lawyer {
  const { data } = useSession();
  if (!data) throw new Error('useLawyer used outside RequireAuth');
  return data;
}

export const authApi = {
  signup: (body: unknown) => api.post<{ lawyer: Lawyer }>('/auth/signup', body),
  login: (body: unknown) => api.post<{ lawyer: Lawyer }>('/auth/login', body),
  logout: () => api.post<{ message: string }>('/auth/logout'),
  forgotPassword: (body: unknown) => api.post<{ message: string }>('/auth/forgot-password', body),
  resetPassword: (body: unknown) => api.post<{ message: string }>('/auth/reset-password', body),
};
