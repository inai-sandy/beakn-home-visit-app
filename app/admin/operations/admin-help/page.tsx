import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import { loadAdminHelpInbox } from '@/lib/admin-help/actions';

import { AdminHelpInboxClient } from './admin-help-client';

// =============================================================================
// HVA-94: /admin/operations/admin-help — admin inbox + reply UI
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin Help Inbox — Admin',
};

export default async function AdminHelpInboxPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/operations/admin-help');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') redirect('/admin/dashboard');

  const messages = await loadAdminHelpInbox();

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            Admin Help Inbox
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Messages from sales executives that need a reply. Pending appears
            first. Reply once per message — there's no thread.
          </p>
        </header>
        <AdminHelpInboxClient messages={messages} />
      </div>
    </main>
  );
}
