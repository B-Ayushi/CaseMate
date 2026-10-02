import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '../api/http';

// Puts the server's per-field messages onto the matching form fields. Returns the
// general message to show above the form, or null if every error found a field.
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fieldMap: Partial<Record<string, Path<T>>> = {},
): string | null {
  if (!(error instanceof ApiError)) {
    return 'Something went wrong. Please try again.';
  }
  const entries = Object.entries(error.fields);
  for (const [serverField, message] of entries) {
    const field = (fieldMap[serverField] ?? serverField) as Path<T>;
    setError(field, { type: 'server', message });
  }
  return entries.length > 0 ? null : error.message;
}

// Where to go after logging in: only paths inside this app, never another site.
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
    ? next
    : '/';
}
