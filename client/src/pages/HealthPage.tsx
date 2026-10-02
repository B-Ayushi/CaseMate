import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../api/health';

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between py-3">
      <dt className="text-slate-600">{label}</dt>
      <dd
        className={`rounded-full px-3 py-1 text-sm font-medium ${
          ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
        }`}
      >
        {label.toLowerCase()}: {ok ? 'ok' : 'error'}
      </dd>
    </div>
  );
}

export function HealthPage() {
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 font-sans text-slate-900">
      <section
        aria-labelledby="health-title"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h1 id="health-title" className="text-2xl font-semibold">
          CaseMate
        </h1>
        <p className="mt-1 text-slate-600">System status</p>

        <div role="status" aria-live="polite" className="mt-6">
          {isPending && <p className="text-slate-600">Checking the server and database…</p>}

          {error && (
            <p className="rounded-lg bg-red-50 p-3 text-red-800">{(error as Error).message}</p>
          )}

          {data && (
            <>
              <dl className="divide-y divide-slate-100">
                <StatusRow label="Status" ok={data.status === 'ok'} />
                <StatusRow label="Database" ok={data.database === 'ok'} />
              </dl>
              {data.status === 'error' && (
                <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{data.message}</p>
              )}
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="mt-6 w-full rounded-lg bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:opacity-60"
        >
          {isFetching ? 'Checking…' : 'Check again'}
        </button>
      </section>
    </main>
  );
}
