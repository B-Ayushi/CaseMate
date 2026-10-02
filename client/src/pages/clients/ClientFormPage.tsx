import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../../api/http';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  SelectField,
  Spinner,
  TextAreaField,
  TextField,
} from '../../components/ui';
import {
  preferredContactLabels,
  useClient,
  useSaveClient,
  type ClientProfile,
} from '../../features/clients/api';
import { applyServerErrors, safeNext } from '../../lib/forms';
import { paiseToRupeesInput, rupeesToPaise } from '../../lib/money';
import { clientFormSchema, type ClientForm } from '../../lib/validation';

const emptyForm: ClientForm = {
  name: '',
  phone: '',
  email: '',
  address: '',
  preferredContact: 'PHONE',
  languages: '',
  hourlyRate: '',
};

function toForm(client: ClientProfile): ClientForm {
  return {
    name: client.name,
    phone: client.phone,
    email: client.email ?? '',
    address: client.address ?? '',
    preferredContact: client.preferredContact,
    languages: client.languages ?? '',
    hourlyRate: paiseToRupeesInput(client.hourlyRatePaise),
  };
}

function ClientFormFields({
  initial,
  clientId,
  returnTo,
}: {
  initial: ClientForm;
  clientId?: string;
  returnTo?: string | null;
}) {
  const navigate = useNavigate();
  const save = useSaveClient(clientId);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ClientForm>({ resolver: zodResolver(clientFormSchema), defaultValues: initial });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const saved = await save.mutateAsync({
        name: values.name,
        phone: values.phone,
        email: values.email || null,
        address: values.address || null,
        preferredContact: values.preferredContact,
        languages: values.languages || null,
        hourlyRatePaise: values.hourlyRate ? rupeesToPaise(values.hourlyRate) : null,
      });
      // Opened from another form (such as Add Case): go back there with this client chosen.
      navigate(returnTo ? `${safeNext(returnTo)}?clientId=${saved.id}` : `/clients/${saved.id}`, {
        replace: true,
      });
    } catch (error) {
      setFormError(applyServerErrors(error, setError, { hourlyRatePaise: 'hourlyRate' }));
    }
  });

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <TextField label="Name" required error={errors.name?.message} {...register('name')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Mobile number"
            type="tel"
            inputMode="tel"
            required
            hint="For example 98765 43210"
            error={errors.phone?.message}
            {...register('phone')}
          />
          <TextField
            label="Email"
            type="email"
            error={errors.email?.message}
            {...register('email')}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Preferred contact"
            error={errors.preferredContact?.message}
            {...register('preferredContact')}
          >
            {Object.entries(preferredContactLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Languages"
            hint="For example Marathi, Hindi"
            error={errors.languages?.message}
            {...register('languages')}
          />
        </div>
        <TextAreaField label="Address" error={errors.address?.message} {...register('address')} />
        <TextField
          label="Hourly rate (₹)"
          inputMode="decimal"
          hint="Leave empty to use your default rate"
          error={errors.hourlyRate?.message}
          {...register('hourlyRate')}
        />
        <div className="flex flex-wrap gap-2 pt-2">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : clientId ? 'Save changes' : 'Add client'}
          </Button>
          <ButtonLink
            to={returnTo ? safeNext(returnTo) : clientId ? `/clients/${clientId}` : '/clients'}
            variant="secondary"
          >
            Cancel
          </ButtonLink>
        </div>
      </form>
    </Card>
  );
}

export function NewClientPage() {
  const [params] = useSearchParams();
  return (
    <div className="space-y-4">
      <Link to="/clients" className="text-sm text-indigo-700 hover:underline lg:hidden">
        ← All clients
      </Link>
      <h2 className="text-xl font-semibold text-slate-900">Add a client</h2>
      <ClientFormFields initial={emptyForm} returnTo={params.get('returnTo')} />
    </div>
  );
}

export function EditClientPage() {
  const { id = '' } = useParams();
  const client = useClient(id);

  if (client.isPending) return <Spinner label="Loading client…" />;
  if (client.isError) return <Alert>{errorMessage(client.error)}</Alert>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900">Edit {client.data.name}</h2>
      <ClientFormFields initial={toForm(client.data)} clientId={id} />
    </div>
  );
}
