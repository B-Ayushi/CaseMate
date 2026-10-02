import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Button, TextField, TextLink } from '../../components/ui';
import { authApi } from '../../features/auth/api';
import { applyServerErrors } from '../../lib/forms';
import { forgotPasswordSchema, type ForgotPasswordForm } from '../../lib/validation';
import { AuthLayout } from './AuthLayout';

export function ForgotPasswordPage() {
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordForm>({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { message } = await authApi.forgotPassword(values);
      setSentMessage(message);
    } catch (error) {
      setFormError(applyServerErrors(error, setError));
    }
  });

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter the email you signed up with and we will send you a link."
      footer={<TextLink to="/login">Back to log in</TextLink>}
    >
      {sentMessage ? (
        <Alert tone="success">
          {sentMessage} The link works for 30 minutes. Check your spam folder if it does not arrive.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {formError && <Alert>{formError}</Alert>}
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            required
            error={errors.email?.message}
            {...register('email')}
          />
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
