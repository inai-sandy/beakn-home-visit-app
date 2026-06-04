import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';

import { NumericConfigClient } from '../_shared/NumericConfigClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Refund window — Beakn admin',
};

export default async function RefundWindowPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/settings/workflow/refund-window');
  if ((session.user as { role?: string }).role !== 'super_admin') {
    redirect('/admin/dashboard');
  }

  const currentValue = await getConfig('refund_window_days');

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
            Settings · Workflow
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Refund window
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            How many days after <strong>Order Confirmed</strong> a refund
            (outbound payment) can still be recorded. Enforced at the
            payment action — captain/admin attempting to record an
            outbound payment past the window gets a clear error.
          </p>
        </header>

        <NumericConfigClient
          configKey="refund_window_days"
          currentValue={currentValue}
          label="New window (days)"
          unit="days"
          max={3650}
          zeroMeans="Refunds always allowed (window disabled)"
        />
      </div>
    </main>
  );
}
