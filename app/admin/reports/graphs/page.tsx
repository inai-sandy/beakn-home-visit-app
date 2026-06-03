import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Icon } from '@/components/ui/icon';
import { getServerSession } from '@/lib/auth-server';

// =============================================================================
// /admin/reports/graphs — visual dashboard (Sprint 4)
// =============================================================================
//
// Sprint 1 ships the table reports. The dedicated graphs page lands
// in Sprint 4 with recharts-rendered line / bar / pie charts of the
// same data. This placeholder exists so the "Graphs view" CTA on the
// reports landing doesn't 404.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Graphs — Beakn admin',
};

export default async function AdminReportsGraphsPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/reports/graphs');
  if ((session.user as { role?: string }).role !== 'super_admin') {
    redirect('/login');
  }

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      <Link
        href="/admin/reports"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Icon name="arrow_back" size="xs" />
        Back to reports
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          Graphs view
        </h1>
        <p className="text-sm text-muted-foreground">
          Visual dashboard with chart variants of the table reports —
          ships in Sprint 4.
        </p>
      </header>

      <section className="rounded-3xl border bg-card p-12 text-center space-y-3">
        <Icon
          name="bar_chart"
          size="lg"
          className="text-muted-foreground mx-auto"
          aria-hidden
        />
        <p className="text-sm text-muted-foreground">
          The graphs surface is being built. Use the{' '}
          <Link
            href="/admin/reports"
            className="text-primary hover:underline"
          >
            table reports
          </Link>{' '}
          for now.
        </p>
      </section>
    </main>
  );
}
