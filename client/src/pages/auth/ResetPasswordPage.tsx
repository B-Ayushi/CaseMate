import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, TextField, TextLink } from '../../components/ui';
import { authApi } from '../../features/auth/api';
import { applyServerErrors } from '../../lib/forms';
import { resetPasswordSchema, type ResetPasswordForm } from '../../lib/validation';
import { AuthLayout } from './AuthLayout';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordForm>({ resolver: zodResolver(resetPasswordSchema) });

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError(null);
    try {
      await authApi.resetPassword({ token, password });
      navigate('/login?reset=1', { replace: true });
    } catch (error) {
      setFormError(applyServerErrors(error, setError, { token: 'password' }));
    }
  });

  if (!token) {
    return (
      <AuthLayout
        title="Reset link incomplete"
        footer={<TextLink to="/login">Back to log in</TextLink>}
      >
        <Alert>
          This link is missing its code. Open the link from the email again, or{' '}
          <TextLink to="/forgot-password">request a new one</TextLink>.
        </Alert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Choose a new password"
      footer={<TextLink to="/forgot-password">Request a new link</TextLink>}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 8 characters, with a letter and a number"
          error={errors.password?.message}
          {...register('password')}
        />
        <TextField
          label="Repeat new password"
          type="password"
          autoComplete="new-password"
          required
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? 'Saving…' : 'Save new password'}
        </Button>
      </form>
    </AuthLayout>
  );
}
