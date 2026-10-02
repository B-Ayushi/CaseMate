import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Button, TextField, TextLink } from '../../components/ui';
import { authApi, SESSION_KEY } from '../../features/auth/api';
import { applyServerErrors } from '../../lib/forms';
import { signupSchema, type SignupForm } from '../../lib/validation';
import { AuthLayout } from './AuthLayout';

export function SignupPage() {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignupForm>({ resolver: zodResolver(signupSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { lawyer } = await authApi.signup(values);
      // PublicOnly sees the session and moves on to the requested page.
      queryClient.setQueryData(SESSION_KEY, lawyer);
    } catch (error) {
      setFormError(applyServerErrors(error, setError));
    }
  });

  return (
    <AuthLayout
      title="Create your account"
      subtitle="One account per advocate. It takes a minute."
      footer={
        <>
          Already have an account? <TextLink to="/login">Log in</TextLink>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <TextField
          label="Full name"
          autoComplete="name"
          required
          error={errors.name?.message}
          {...register('name')}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          error={errors.email?.message}
          {...register('email')}
        />
        <TextField
          label="Mobile number"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          required
          hint="Used for SMS reminders, for example 98765 43210"
          error={errors.phone?.message}
          {...register('phone')}
        />
        <TextField
          label="Bar Council enrolment number"
          required
          hint="For example MAH/1234/2015"
          error={errors.barCouncilNumber?.message}
          {...register('barCouncilNumber')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 8 characters, with a letter and a number"
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
