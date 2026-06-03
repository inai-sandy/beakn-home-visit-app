import type { Metadata } from 'next';

import { Icon } from '@/components/ui/icon';
import { loadPendingCollections } from '@/lib/captain/dashboard-queries';
import { getIstDateString } from '@/lib/today/time';

import { ViewOnlyNotice } from '../_components/ViewOnlyNotice';

// MVP mirror of /captain/collections (Finance) scoped to URL captainId.
// Shows the outstanding-collections summary + aging buckets. The full
// captain page also has a per-order list with record-payment actions;
// those follow as a polish pass.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Finance — Beakn admin',
};

function formatRupees(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

export default async function AdminPortalCollectionsPage({
  params,
}: {
  params: Promise<unknown>;
}) {
  const { captainId } = (await params) as { captainId: string };
  const istToday = getIstDateString();
  const summary = await loadPendingCollections(captainId, {
    mode: 'single',
    date: istToday,
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Outstanding collections across this captain's team.
        </p>
      </header>
      <ViewOnlyNotice message="Recording payments is captain / exec only. Admin can review aging here." />

      <section className="rounded-3xl border bg-card p-5 space-y-3">
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {formatRupees(summary.totalDueRupees)}
        </p>
        <p className="text-[11px] text-muted-foreground">
          Across {summary.outstandingRequestCount} {summary.outstandingRequestCount === 1 ? 'request' : 'requests'}
          {summary.staleCount > 0 && (
            <>
              {' · '}
              <span className="text-amber-700 dark:text-amber-300 font-medium inline-flex items-center gap-1">
                <Icon name="warning" size="xs" />
                {summary.staleCount} &gt; 48h
              </span>
            </>
          )}
        </p>
        <div className="divide-y rounded-2xl border bg-muted/20 px-3">
          <Row label="0–7 days" tone="bg-green-500" value={summary.buckets.zeroToSeven} />
          <Row label="8–30 days" tone="bg-amber-500" value={summary.buckets.eightToThirty} />
          <Row label="30+ days" tone="bg-red-500" value={summary.buckets.thirtyPlus} />
        </div>
      </section>
    </div>
  );
}

function Row({
  label,
  tone,
  value,
}: {
  label: string;
  tone: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex items-center gap-2 text-xs">
        <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${tone}`} />
        <span className="text-muted-foreground">{label}</span>
      </div>
      <span className="text-sm font-mono">{formatRupees(value)}</span>
    </div>
  );
}
