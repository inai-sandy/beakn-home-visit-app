import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import {
  loadAllResourceCategoriesForAdmin,
  loadAllResourcesForAdmin,
} from '@/lib/content/queries';

import { ResourcesClient } from './resources-client';

// =============================================================================
// HVA-156: /admin/content/resources — super_admin CRUD for resources
// =============================================================================
//
// Lists every resource (including unpublished). Renders a single client
// island that owns the create + edit modals. Mirrors the HVA-91 admin
// CRUD pattern.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Resources — Admin',
};

export default async function AdminResourcesPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/content/resources');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') redirect('/admin/dashboard');

  const [resources, categories] = await Promise.all([
    loadAllResourcesForAdmin(),
    loadAllResourceCategoriesForAdmin(),
  ]);

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Resources</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Sales enablement material visible to every captain and executive.
            </p>
          </div>
        </header>
        <ResourcesClient resources={resources} categories={categories} />
      </div>
    </main>
  );
}
