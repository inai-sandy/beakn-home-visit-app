import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { loadCartplusExecs } from '@/lib/admin/cartplus';

import { CartplusExecsClient } from './CartplusExecsClient';

// =============================================================================
// HVA-248 / HVA-248-FIX2: CartPlus user↔portal_exec_id mapping page
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'CartPlus execs — Admin — Beakn',
};

export default async function CartplusExecsPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/integrations/cartplus/execs');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') redirect('/admin/dashboard');

  const execs = await loadCartplusExecs();

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            CartPlus exec mapping
          </h1>
          <p className="text-sm text-muted-foreground">
            Map every active sales executive (and captain) to their CartPlus
            user ID — the number in <code>data.order.created_by.id</code>.
            Unmapped users won't be auto-assigned; their orders go to the
            unassigned bucket and admin gets pinged.
          </p>
        </header>

        <CartplusExecsClient rows={execs} />
      </div>
    </main>
  );
}
