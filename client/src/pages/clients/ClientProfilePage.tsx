import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/http';
import { Alert, Badge, Button, ButtonLink, Card, Spinner, TextLink } from '../../components/ui';
import {
  preferredContactLabels,
  useClient,
  useDeleteClient,
  type ClientProfile,
} from '../../features/clients/api';
import { formatDay, formatTime } from '../../lib/dates';
import { formatPaise } from '../../lib/money';
import { ClientNotes } from './ClientNotes';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

function ContactCard({ client }: { client: ClientProfile }) {
  const whatsappNumber = client.phone.replace(/^\+/, '');
  return (
    <Card title="Contact">
      <dl className="grid gap-4 sm:grid-cols-2">
        <Detail label="Phone">
          <a className="text-indigo-700 hover:underline" href={`tel:${client.phone}`}>
            {client.phone}
          </a>
          {' · '}
          <a
            className="text-indigo-700 hover:underline"
            href={`https://wa.me/${whatsappNumber}`}
            target="_blank"
            rel="noreferrer"
          >
            WhatsApp
          </a>
        </Detail>
        <Detail label="Email">
          {client.email ? (
            <a className="text-indigo-700 hover:underline" href={`mailto:${client.email}`}>
              {client.email}
            </a>
          ) : (
            <span className="text-slate-500">Not added</span>
          )}
        </Detail>
        <Detail label="Prefers">{preferredContactLabels[client.preferredContact]}</Detail>
        <Detail label="Languages">
          {client.languages ?? <span className="text-slate-500">Not added</span>}
        </Detail>
        <Detail label="Hourly rate">
          {client.hourlyRatePaise !== null ? (
            formatPaise(client.hourlyRatePaise)
          ) : (
            <span className="text-slate-500">Your default rate</span>
          )}
        </Detail>
        <Detail label="Address">
          {client.address ? (
            <span className="whitespace-pre-line">{client.address}</span>
          ) : (
            <span className="text-slate-500">Not added</span>
          )}
        </Detail>
      </dl>
    </Card>
  );
}

function CasesCard({ client }: { client: ClientProfile }) {
  return (
    <Card title="Cases">
      {client.cases.length === 0 ? (
        <p className="text-sm text-slate-600">No cases for this client yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {client.cases.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="font-medium text-slate-900">{c.title}</p>
                <p className="text-sm text-slate-600">
                  {c.caseNumber} · {c.courtName}
                </p>
              </div>
              <div className="text-right text-sm">
                {c.status === 'CLOSED' ? (
                  <Badge>Closed</Badge>
                ) : c.nextHearingAt ? (
                  <span className="text-slate-800">
                    Next: {formatDay(c.nextHearingAt)}, {formatTime(c.nextHearingAt)}
                  </span>
                ) : (
                  <Badge tone="amber">No next date</Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function BillingCard({ client }: { client: ClientProfile }) {
  const { billedPaise, paidPaise, duePaise, overduePaise, unbilledPaise } = client.billing;
  const rows = [
    { label: 'Billed', value: billedPaise },
    { label: 'Paid', value: paidPaise },
    { label: 'Due', value: duePaise },
    { label: 'Not yet billed', value: unbilledPaise },
  ];
  return (
    <Card title="Billing" actions={<TextLink to="/billing">Invoices and time</TextLink>}>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {row.label}
            </dt>
            <dd className="mt-0.5 text-lg font-semibold text-slate-900">
              {formatPaise(row.value)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-slate-600">
        From this client’s invoices: drafts are not counted until they are sent.
      </p>
      {overduePaise > 0 && (
        <div className="mt-4">
          <Alert tone="warning">{formatPaise(overduePaise)} is overdue.</Alert>
        </div>
      )}
    </Card>
  );
}

export function ClientProfilePage() {
  const { id = '' } = useParams();
  const client = useClient(id);
  const deleteClient = useDeleteClient();
  const navigate = useNavigate();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (client.isPending) return <Spinner label="Loading client…" />;
  if (client.isError) {
    const notFound = client.error instanceof ApiError && client.error.status === 404;
    return (
      <Alert>
        {notFound ? 'This client does not exist or has been deleted.' : errorMessage(client.error)}{' '}
        <TextLink to="/clients">Back to clients</TextLink>
      </Alert>
    );
  }

  const data = client.data;

  async function onDelete() {
    if (!window.confirm(`Delete ${data.name}? This also deletes their notes.`)) return;
    setDeleteError(null);
    try {
      await deleteClient.mutateAsync(data.id);
      navigate('/clients', { replace: true });
    } catch (error) {
      setDeleteError(errorMessage(error));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/clients" className="text-sm text-indigo-700 hover:underline lg:hidden">
            ← All clients
          </Link>
          <h2 className="text-xl font-semibold text-slate-900">{data.name}</h2>
        </div>
        <div className="flex gap-2">
          <ButtonLink to={`/clients/${data.id}/edit`} variant="secondary">
            Edit
          </ButtonLink>
          <Button variant="ghost" onClick={onDelete} disabled={deleteClient.isPending}>
            Delete
          </Button>
        </div>
      </div>
      {deleteError && <Alert>{deleteError}</Alert>}
      <ContactCard client={data} />
      <CasesCard client={data} />
      <BillingCard client={data} />
      <ClientNotes clientId={data.id} notes={data.notes} />
    </div>
  );
}
