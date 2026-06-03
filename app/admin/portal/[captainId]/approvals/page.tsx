import { formatDistanceToNow } from 'date-fns';
import type { Metadata } from 'next';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { loadPendingApprovals } from '@/lib/captain/dashboard-queries';
import { getIstDateString } from '@/lib/today/time';

import { ViewOnlyNotice } from '../_components/ViewOnlyNotice';

// MVP mirror of /captain/approvals scoped to URL captainId. Shows the
// pending-captain-approval queue as a list. The captain page has
// inline approve/reject buttons; in admin view the actions are
// suppressed entirely (admin would only review).

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pending Approvals — Beakn admin',
};

export default async function AdminPortalApprovalsPage({
  params,
}: {
  params: Promise<unknown>;
}) {
  const { captainId } = (await params) as { captainId: string };
  const istToday = getIstDateString();
  const result = await loadPendingApprovals(captainId, {
    mode: 'single',
    date: istToday,
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">
          Pending Approvals
        </h1>
        <Badge variant={result.totalCount > 0 ? 'default' : 'secondary'}>
          {result.totalCount} pending
        </Badge>
      </header>
      <ViewOnlyNotice message="Approve / reject actions are captain-only. Admin can review the queue here." />
      {result.staleCount > 0 && (
        <div className="rounded-2xl border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 flex items-center gap-2">
          <Icon name="warning" size="sm" />
          <span>
            <strong>{result.staleCount}</strong> waiting &gt; 24h.
          </span>
        </div>
      )}
      {result.totalCount === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No approvals waiting right now.
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {result.topFive.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{r.customerName}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {r.execName ?? 'Unassigned'}
                </p>
              </div>
              <div className="text-[11px] text-muted-foreground shrink-0">
                {r.completedAt
                  ? formatDistanceToNow(r.completedAt, { addSuffix: true })
                  : '—'}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
