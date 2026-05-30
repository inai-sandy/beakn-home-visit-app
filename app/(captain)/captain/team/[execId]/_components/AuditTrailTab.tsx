import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import type { ExecAuditRow } from '@/lib/captain/exec-drill-queries';

interface Props {
  rows: ExecAuditRow[];
  page: number;
  pageSize: number;
  total: number;
  execId: string;
  preservedQuery: Record<string, string>;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  'request.status_changed': 'Status changed',
  'request.assigned': 'Request assigned',
  'request.reassigned': 'Request reassigned',
  'request.approved': 'Captain approved',
  'request.rejected': 'Captain rejected',
  'request.rolled_back': 'Status rolled back',
  'request.scheduled': 'Visit scheduled',
  'request.rescheduled': 'Visit rescheduled',
  'request.cancelled_by_customer': 'Customer cancelled',
  payment_recorded: 'Payment recorded',
  payment_voided: 'Payment voided',
  refund_recorded: 'Refund recorded',
  quotation_submitted: 'Quotation submitted',
  day_plan_submitted: 'Day plan submitted',
  day_plan_closed: 'Day closed',
  task_added: 'Task added',
  task_completed: 'Task completed',
  task_postponed: 'Task postponed',
  assist_request_created: 'Assist requested',
  user_login: 'Signed in',
  user_logout: 'Signed out',
};

function eventLabel(code: string): string {
  return EVENT_TYPE_LABELS[code] ?? code.replace(/[._]/g, ' ');
}

function entityHref(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  if (entityType === 'visit_request') return `/requests/${entityId}`;
  return null;
}

export function AuditTrailTab({
  rows,
  page,
  pageSize,
  total,
  execId,
  preservedQuery,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-8 text-center">
        <Icon
          name="history"
          size="lg"
          className="text-muted-foreground/60 mx-auto"
        />
        <p className="mt-3 text-sm text-muted-foreground">
          No audit log entries for this exec yet.
        </p>
      </div>
    );
  }

  function pageHref(targetPage: number): string {
    const sp = new URLSearchParams(preservedQuery);
    sp.set('tab', 'audit');
    if (targetPage > 1) sp.set('page', String(targetPage));
    else sp.delete('page');
    return `/captain/team/${execId}?${sp.toString()}`;
  }

  return (
    <div className="space-y-3">
      <ul className="rounded-2xl border bg-card divide-y overflow-hidden">
        {rows.map((r) => {
          const link = entityHref(r.targetEntityType, r.targetEntityId);
          const inner = (
            <div className="px-4 py-3 space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium min-w-0 truncate">
                  {eventLabel(r.eventType)}
                </p>
                <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                  {formatDistanceToNow(r.createdAt, { addSuffix: true })}
                </span>
              </div>
              {r.targetEntityType && (
                <Badge variant="outline" className="text-[10px] capitalize">
                  {r.targetEntityType.replace(/_/g, ' ')}
                </Badge>
              )}
              {r.reason && (
                <p className="text-xs text-muted-foreground break-words">
                  {r.reason}
                </p>
              )}
            </div>
          );
          return (
            <li key={r.id}>
              {link ? (
                <Link href={link} className="block hover:bg-muted/40">
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>

      {totalPages > 1 && (
        <nav
          aria-label="Audit pages"
          className="flex items-center justify-between gap-2 text-xs"
        >
          <div className="text-muted-foreground">
            Page {page} of {totalPages} · {total} entr{total === 1 ? 'y' : 'ies'}
          </div>
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Link
                href={pageHref(page - 1)}
                className="px-3 py-1.5 rounded-md border hover:bg-muted/60"
              >
                Previous
              </Link>
            ) : (
              <span className="px-3 py-1.5 rounded-md border opacity-40 cursor-not-allowed">
                Previous
              </span>
            )}
            {page < totalPages ? (
              <Link
                href={pageHref(page + 1)}
                className="px-3 py-1.5 rounded-md border hover:bg-muted/60"
              >
                Next
              </Link>
            ) : (
              <span className="px-3 py-1.5 rounded-md border opacity-40 cursor-not-allowed">
                Next
              </span>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
