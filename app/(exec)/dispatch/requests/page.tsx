import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { RequestStatusBadge } from '@/components/dispatch-requests/RequestStatusBadge';
import { BackButton } from '@/components/ui/back-button';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { getServerSession } from '@/lib/auth-server';
import { loadDispatchRequests } from '@/lib/dispatch-requests/queries';
import { summariseGroups } from '@/lib/dispatch-requests/status';

// HVA-342: /dispatch/requests — what this exec has asked support for.
//
// Replaces /assist. The summary line is per-order rather than per-request,
// because a request spanning three customers can be half done and the exec
// needs to see which half.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'My dispatch requests — Beakn',
  description: 'Material you have asked support to dispatch.',
};

const DATE_FMT = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
});

export default async function ExecDispatchRequestsPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/dispatch/requests');

  const user = session.user as { id: string; role?: string };
  if (user.role !== 'sales_executive' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const rows = await loadDispatchRequests(
    // super_admin sees everyone's — they hold no orders of their own, so an
    // exec-scoped list would always be empty for them.
    user.role === 'super_admin' ? {} : { execUserId: user.id },
  );

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 md:max-w-5xl">
        <BackButton fallback="/dispatch" />
        <header className="mt-4 mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">My dispatch requests</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Material you have asked support to send out.
            </p>
          </div>
          {user.role === 'sales_executive' && (
            <Button asChild size="sm">
              <Link href="/dispatch/new">New request</Link>
            </Button>
          )}
        </header>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Icon
              name="inventory_2"
              size="lg"
              className="text-muted-foreground"
              aria-hidden
            />
            <p className="mt-3 font-medium">No requests yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              When you need support to dispatch something, ask from the
              Dispatch screen.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/dispatch/requests/${row.id}`}
                  className="block rounded-lg border p-4 transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium leading-tight">
                        {row.totalQty} {row.totalQty === 1 ? 'unit' : 'units'}{' '}
                        across {row.orderCount}{' '}
                        {row.orderCount === 1 ? 'order' : 'orders'}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {summariseGroups(row.groupStatuses)}
                      </p>
                    </div>
                    <RequestStatusBadge status={row.status} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Asked {DATE_FMT.format(row.createdAt)}
                    {row.priority === 'high' && ' · Urgent'}
                    {row.requiredByDate && ` · needed by ${row.requiredByDate}`}
                    {user.role === 'super_admin' &&
                      row.execName &&
                      ` · ${row.execName}`}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
