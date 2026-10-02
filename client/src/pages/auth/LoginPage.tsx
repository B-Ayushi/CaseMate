import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, TextField, TextLink } from '../../components/ui';
import { authApi, SESSION_KEY } from '../../features/auth/api';
import { applyServerErrors } from '../../lib/forms';
import { loginSchema, type LoginForm } from '../../lib/validation';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { lawyer } = await authApi.login(values);
      // PublicOnly sees the session and moves on to the requested page.
      queryClient.setQueryData(SESSION_KEY, lawyer);
    } catch (error) {
      setFormError(applyServerErrors(error, setError));
    }
  });

  return (
    <AuthLayout
      title="Log in"
      subtitle="Welcome back. Your hearings are waiting."
      footer={
        <>
          New to CaseMate? <TextLink to="/signup">Create an account</TextLink>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {params.get('reset') === '1' && (
          <Alert tone="success">Your password has been changed. Log in with the new one.</Alert>
        )}
        {formError && <Alert>{formError}</Alert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          error={errors.password?.message}
          {...register('password')}
        />
        <div className="flex justify-end">
          <TextLink to="/forgot-password" className="text-sm">
            Forgot password?
          </TextLink>
        </div>
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
