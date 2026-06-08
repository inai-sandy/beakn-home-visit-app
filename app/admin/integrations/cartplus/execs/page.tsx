import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { loadCartplusExecs } from '@/lib/admin/cartplus';

import { CartplusExecsClient } from './CartplusExecsClient';

// =============================================================================
// HVA-248: CartPlus user↔portal_exec_id mapping page
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
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          CartPlus exec mapping
        </h1>
        <p className="text-sm text-muted-foreground">
          Map every HVA sales executive (and captain) to their CartPlus user
          ID — the value of <code>data.order.created_by.id</code> on
          webhooks. Unmapped users won't be auto-assigned: the request goes
          to the unassigned bucket + admin gets pinged.
        </p>
      </header>

      <CartplusExecsClient rows={execs} />
    </section>
  );
}
