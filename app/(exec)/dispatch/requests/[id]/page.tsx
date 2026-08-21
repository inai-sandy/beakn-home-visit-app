import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import {
  OrderStatusBadge,
  RequestStatusBadge,
} from '@/components/dispatch-requests/RequestStatusBadge';
import { WithdrawRequestButton } from '@/components/dispatch-requests/WithdrawRequestButton';
import { BackButton } from '@/components/ui/back-button';
import { getServerSession } from '@/lib/auth-server';
import { loadDispatchRequestDetail } from '@/lib/dispatch-requests/queries';
import { isSettled } from '@/lib/dispatch-requests/status';

// HVA-342: one request, broken down by order.
//
// Per order rather than per product, because that is the unit support decides
// on — an exec looking at this needs to know which customer is covered and
// which is not, not a flat list of products with mixed fates.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Dispatch request — Beakn',
};

interface PageProps {
  params: Promise<{ id: string }>;
}

const DATE_FMT = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export default async function DispatchRequestDetailPage({
  params,
}: PageProps) {
  const session = await getServerSession();
  const { id } = await params;
  if (!session) redirect(`/login?next=/dispatch/requests/${id}`);

  const user = session.user as { id: string; role?: string };
  const detail = await loadDispatchRequestDetail(id);
  if (!detail) notFound();

  // An exec may only open their own. Support and super_admin read every
  // request; support works them from /support/requests but may arrive here
  // from a notification link.
  const canRead =
    detail.execUserId === user.id ||
    user.role === 'super_admin' ||
    user.role === 'support';
  if (!canRead) notFound();

  const canWithdraw =
    detail.status === 'open' &&
    (detail.execUserId === user.id || user.role === 'super_admin') &&
    detail.groups.some((g) => !isSettled(g.status));

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 md:max-w-5xl">
        <BackButton fallback="/dispatch/requests" />

        <header className="mt-4 mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Dispatch request</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Asked {DATE_FMT.format(detail.createdAt)}
              {detail.execName && ` by ${detail.execName}`}
              {detail.priority === 'high' && ' · Urgent'}
              {detail.requiredByDate && ` · needed by ${detail.requiredByDate}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <RequestStatusBadge status={detail.status} />
            {canWithdraw && <WithdrawRequestButton requestId={detail.id} />}
          </div>
        </header>

        {detail.message && (
          <p className="mb-6 rounded-lg border bg-muted/30 p-3 text-sm">
            {detail.message}
          </p>
        )}

        <div className="space-y-4">
          {detail.groups.map((group) => (
            <section
              key={group.id}
              className="rounded-lg border overflow-hidden"
            >
              <header className="flex items-start justify-between gap-3 bg-muted/40 px-4 py-3">
                <div className="min-w-0">
                  <h2 className="font-medium leading-tight">
                    {group.customerName}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {group.cityName}
                  </p>
                </div>
                <OrderStatusBadge status={group.status} />
              </header>

              <ul className="divide-y">
                {group.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p
                        className={
                          item.cancelledAt
                            ? 'line-through text-muted-foreground'
                            : ''
                        }
                      >
                        {item.productName}
                      </p>
                      {item.cancelledAt && (
                        <p className="mt-0.5 text-xs text-rose-700">
                          {item.cancelledReason ?? 'Cancelled'}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 tabular-nums text-sm text-muted-foreground">
                      ×{item.quantity}
                    </span>
                  </li>
                ))}
              </ul>

              {group.decisionReason && (
                <p className="border-t bg-muted/20 px-4 py-2 text-sm">
                  <span className="text-muted-foreground">
                    {group.status === 'approved' ? 'Note' : 'Reason'}:{' '}
                  </span>
                  {group.decisionReason}
                </p>
              )}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
