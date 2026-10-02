import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { errorMessage } from '../../api/http';
import { Alert, Button, Card, TextAreaField } from '../../components/ui';
import { useAddClientNote, useDeleteClientNote, type ClientNote } from '../../features/clients/api';
import { formatDateTime } from '../../lib/dates';
import { applyServerErrors } from '../../lib/forms';
import { requiredText } from '../../lib/validation';

const noteSchema = z.object({ text: requiredText(5000, 'Write the note') });
type NoteForm = z.infer<typeof noteSchema>;

export function ClientNotes({ clientId, notes }: { clientId: string; notes: ClientNote[] }) {
  const addNote = useAddClientNote(clientId);
  const deleteNote = useDeleteClientNote(clientId);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<NoteForm>({ resolver: zodResolver(noteSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await addNote.mutateAsync(values);
      reset({ text: '' });
    } catch (error) {
      setFormError(applyServerErrors(error, setError));
    }
  });

  return (
    <Card title="Notes">
      <form onSubmit={onSubmit} noValidate className="space-y-3">
        {formError && <Alert>{formError}</Alert>}
        <TextAreaField
          label="Add a note from a call or meeting"
          error={errors.text?.message}
          {...register('text')}
        />
        <Button type="submit" variant="secondary" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save note'}
        </Button>
      </form>

      {deleteNote.isError && (
        <div className="mt-3">
          <Alert>{errorMessage(deleteNote.error)}</Alert>
        </div>
      )}

      {notes.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">No notes yet.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {notes.map((note) => (
            <li key={note.id} className="rounded-lg bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-medium text-slate-600">{formatDateTime(note.notedAt)}</p>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Delete this note?')) deleteNote.mutate(note.id);
                  }}
                  className="text-xs font-medium text-slate-600 hover:text-red-700 hover:underline focus-visible:outline-2 focus-visible:outline-indigo-600"
                >
                  Delete<span className="sr-only"> note from {formatDateTime(note.notedAt)}</span>
                </button>
              </div>
              <p className="mt-1 whitespace-pre-line text-sm text-slate-900">{note.text}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
