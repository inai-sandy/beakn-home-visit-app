import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';

import type { PendingApprovalRow } from '@/lib/captain/dashboard-queries';

// =============================================================================
// HVA-80: Pending Approvals card — count badge + top-5 list
// =============================================================================
//
// "View all" → /captain/approvals (the existing HVA-137 full screen).
// Bundle text said "/captain/pending-approvals" but the actual route is
// /captain/approvals; documented in PR description.
// =============================================================================

interface Props {
  totalCount: number;
  topFive: PendingApprovalRow[];
}

export function PendingApprovalsCard({ totalCount, topFive }: Props) {
  return (
    <section
      aria-label="Pending approvals"
      className="rounded-3xl border bg-card p-5 shadow-sm space-y-3"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">
          Pending Approvals
        </h2>
        <Badge variant={totalCount > 0 ? 'default' : 'secondary'} className="text-xs">
          {totalCount}
        </Badge>
      </header>

      {topFive.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Nothing waiting for you right now.
        </p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-muted/20">
          {topFive.map((row) => (
            <li key={row.id}>
              <Link
                href={`/requests/${row.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{row.customerName}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {row.execName ?? 'Unassigned'}
                  </p>
                </div>
                <div className="text-[11px] text-muted-foreground shrink-0">
                  {row.completedAt
                    ? formatDistanceToNow(row.completedAt, { addSuffix: true })
                    : '—'}
                </div>
                <Icon name="chevron_right" size="xs" className="text-muted-foreground shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {totalCount > 5 && (
        <div className="flex justify-end">
          <Link
            href="/captain/approvals"
            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
          >
            View all {totalCount}
            <Icon name="arrow_forward" size="xs" />
          </Link>
        </div>
      )}
    </section>
  );
}
