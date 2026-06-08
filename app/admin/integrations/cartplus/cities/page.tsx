import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { loadCartplusCities } from '@/lib/admin/cartplus';

import { CartplusCitiesClient } from './CartplusCitiesClient';

// =============================================================================
// HVA-248: CartPlus city↔store_id mapping page
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'CartPlus cities — Admin — Beakn',
};

export default async function CartplusCitiesPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/integrations/cartplus/cities');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') redirect('/admin/dashboard');

  const cities = await loadCartplusCities();

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          CartPlus city mapping
        </h1>
        <p className="text-sm text-muted-foreground">
          The webhook envelope has a <code>store.id</code> field. Map each
          HVA city to its CartPlus store ID so incoming webhooks land on the
          right city. Leave blank to leave a city unmapped — orders for that
          store fall back to "Other" and admin gets a heads-up.
        </p>
      </header>

      <CartplusCitiesClient rows={cities} />
    </section>
  );
}
