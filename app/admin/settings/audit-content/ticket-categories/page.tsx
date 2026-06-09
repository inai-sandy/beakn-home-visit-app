import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { loadAllCategories } from '@/lib/support-tickets/category-queries';

import { TicketCategoriesClient } from './_components/TicketCategoriesClient';

// =============================================================================
// HVA-256-FIX1: /admin/settings/audit-content/ticket-categories
// =============================================================================
//
// CRUD on the support_ticket_categories table. super_admin only. Code
// is editable only on create; name + displayOrder + isActive editable
// in place. No delete — categories with historic tickets stay around;
// admin deactivates instead.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Ticket categories — Admin — Beakn',
};

export default async function TicketCategoriesAdminPage() {
  const session = await getServerSession();
  if (!session) {
    redirect('/login?next=/admin/settings/audit-content/ticket-categories');
  }
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') redirect('/admin/dashboard');

  const categories = await loadAllCategories();

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Customer ticket categories
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage the categories the customer can pick when raising a
            support ticket from <code>/track/[token]</code>. <strong>Code</strong>{' '}
            stays fixed once created (downstream logic like refund auto-close
            reads by code); <strong>name</strong> + <strong>order</strong> +{' '}
            <strong>active</strong> are editable.
          </p>
        </header>

        <TicketCategoriesClient categories={categories} />
      </div>
    </main>
  );
}
