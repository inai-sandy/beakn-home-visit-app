import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';

import { NumericConfigClient } from '../_shared/NumericConfigClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Approval timeout — Beakn admin',
};

export default async function ApprovalTimeoutPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/settings/workflow/approval-timeout');
  if ((session.user as { role?: string }).role !== 'super_admin') {
    redirect('/admin/dashboard');
  }

  const currentValue = await getConfig('pending_captain_approval_timeout_hours');

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
            Settings · Workflow
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Captain approval timeout
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            How long a request can sit in <strong>Pending Captain Approval</strong>{' '}
            before admin gets a push + WhatsApp escalation. The hourly cron
            (<code className="font-mono text-[11px]">/api/cron/escalate-stale-approvals</code>)
            checks every active row. Each breached request is escalated
            once; if the captain hasn't acted by the next cycle, it stays
            in the queue but the alert won't repeat.
          </p>
        </header>

        <NumericConfigClient
          configKey="pending_captain_approval_timeout_hours"
          currentValue={currentValue}
          label="New timeout (hours)"
          unit="hours"
          max={24 * 30}
          zeroMeans="Escalation disabled — no SLA"
        />
      </div>
    </main>
  );
}
