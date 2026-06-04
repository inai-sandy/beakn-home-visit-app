import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';

import { NumericConfigClient } from '../_shared/NumericConfigClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Audit log retention — Beakn admin',
};

export default async function AuditRetentionPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/settings/workflow/audit-retention');
  if ((session.user as { role?: string }).role !== 'super_admin') {
    redirect('/admin/dashboard');
  }

  const currentValue = await getConfig('audit_log_retention_months');

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
            Settings · Workflow
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Audit log retention
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            How long <code className="font-mono text-[11px]">audit_log</code> rows
            are kept before the nightly prune job
            (<code className="font-mono text-[11px]">/api/cron/prune-audit-log</code>, daily 02:30 IST)
            deletes them. Set to 0 to keep audit history forever (no pruning).
          </p>
        </header>

        <NumericConfigClient
          configKey="audit_log_retention_months"
          currentValue={currentValue}
          label="New retention (months)"
          unit="months"
          max={120}
          zeroMeans="Audit log kept forever (pruning disabled)"
        />
      </div>
    </main>
  );
}
