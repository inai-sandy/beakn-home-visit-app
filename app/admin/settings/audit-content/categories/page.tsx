import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { loadAllResourceCategoriesForAdmin } from '@/lib/content/queries';

import { CategoriesClient } from './categories-client';

// =============================================================================
// HVA-156-FIX1: /admin/content/categories — super_admin CRUD for the
// resource categories list that drives the read-surface filter dropdown.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Resource Categories — Admin',
};

export default async function AdminResourceCategoriesPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/content/categories');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') redirect('/admin/dashboard');

  const categories = await loadAllResourceCategoriesForAdmin();

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            Resource categories
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Categories drive the filter dropdown that captains + executives
            see on their Resources page. Deactivating a category hides it
            from new uploads + the filter, but keeps existing resources
            attributed.
          </p>
        </header>
        <CategoriesClient categories={categories} />
      </div>
    </main>
  );
}
