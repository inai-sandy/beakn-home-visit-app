import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { loadAllHolidaysForAdmin } from '@/lib/holidays/actions';

import { HolidaysClient } from './holidays-client';

// =============================================================================
// HVA-93: /admin/settings/workflow/holidays — super_admin CRUD
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Holidays — Admin',
};

export default async function AdminHolidaysPage() {
  const session = await getServerSession();
  if (!session) {
    redirect('/login?next=/admin/settings/workflow/holidays');
  }
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') redirect('/admin/dashboard');

  const holidays = await loadAllHolidaysForAdmin();

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Holidays</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Company holidays. Used by day-plan + target calculation to skip
            non-working days. Applies to all cities; per-city scoping and
            multi-day ranges are deferred.
          </p>
        </header>
        <HolidaysClient holidays={holidays} />
      </div>
    </main>
  );
}
