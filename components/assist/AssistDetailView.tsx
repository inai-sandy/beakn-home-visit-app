import { format } from 'date-fns';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import type { AssistRequestDetail } from '@/lib/assist/queries';
import {
  ASSIST_STATUS_LABELS,
  ASSIST_TYPE_LABELS,
  isTerminalAssistStatus,
} from '@/lib/assist/types';

import { AssistPriorityBadge } from './AssistPriorityBadge';
import { AssistStatusBadge } from './AssistStatusBadge';
import { AssistTransitionActions } from './AssistTransitionActions';

interface Props {
  detail: AssistRequestDetail;
  /** Whether the viewer can run state transitions. captain (team-scoped) + admin = true; exec = false. */
  canTransition: boolean;
  /** Whether the viewer (exec only) can edit this assist. */
  editHref?: string | null;
}

function formatIstDate(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00+05:30`).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function AssistDetailView({ detail, canTransition, editHref }: Props) {
  const terminal = isTerminalAssistStatus(detail.status);
  return (
    <div className="space-y-5">
      <header className="rounded-3xl border bg-card p-5 shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {ASSIST_TYPE_LABELS[detail.type]}
            </p>
            <h1 className="text-xl font-semibold tracking-tight truncate">
              {detail.linkedRequest
                ? `Assist for ${detail.linkedRequest.customerName}`
                : 'Assist request'}
            </h1>
            <p className="text-xs text-muted-foreground">
              Submitted by {detail.exec.fullName} ·{' '}
              {format(detail.createdAt, 'PP p')}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <AssistStatusBadge status={detail.status} />
            <AssistPriorityBadge priority={detail.priority} />
          </div>
        </div>
        {editHref && (
          <div className="flex justify-end">
            <Link
              href={editHref}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Icon name="edit" size="xs" />
              Edit assist
            </Link>
          </div>
        )}
      </header>

      {detail.rejectionReason && (
        <section className="rounded-3xl border border-rose-500/40 bg-rose-50/60 dark:bg-rose-950/20 p-5 space-y-2 shadow-sm">
          <h2 className="text-sm font-semibold tracking-tight text-rose-800 dark:text-rose-200">
            Rejection reason
          </h2>
          <p className="text-sm whitespace-pre-line">{detail.rejectionReason}</p>
        </section>
      )}

      {detail.linkedRequest && (
        <section className="rounded-3xl border bg-card p-5 shadow-sm space-y-2">
          <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
            Customer
          </h2>
          <Link
            href={`/requests/${detail.linkedRequest.id}`}
            className="block rounded-2xl border bg-background p-3 hover:bg-accent/40 transition-colors"
          >
            <p className="text-sm font-semibold">{detail.linkedRequest.customerName}</p>
            <p className="text-xs text-muted-foreground">
              {detail.linkedRequest.cityName} · {detail.linkedRequest.stageCode}
            </p>
          </Link>
        </section>
      )}

      <section className="rounded-3xl border bg-card p-5 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
          Items ({detail.items.length})
        </h2>
        {detail.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items specified.</p>
        ) : (
          <ul className="space-y-1.5">
            {detail.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between text-sm">
                <span>{item.productName}</span>
                <Badge variant="outline" className="tabular-nums text-xs">
                  × {item.quantity}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border bg-card p-5 shadow-sm space-y-2">
        <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
          Details
        </h2>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Order number</dt>
            <dd className="font-medium break-words">
              {detail.orderNumber || '—'}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Dispatch by</dt>
            <dd className="font-medium break-words">
              {detail.dispatchByDate ? formatIstDate(detail.dispatchByDate) : '—'}
            </dd>
          </div>
          <div className="col-span-2 min-w-0">
            <dt className="text-xs text-muted-foreground">Message</dt>
            <dd className="whitespace-pre-line break-words">
              {detail.message || '—'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-3xl border bg-card p-5 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
          Status timeline
        </h2>
        {detail.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No status changes yet.</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {detail.history.map((h) => (
              <li
                key={h.id}
                className="flex items-start gap-3 rounded-2xl border bg-background p-3"
              >
                <Icon
                  name={
                    h.toStatus === 'rejected'
                      ? 'cancel'
                      : h.toStatus === 'dispatched'
                        ? 'local_shipping'
                        : h.toStatus === 'processing'
                          ? 'sync'
                          : h.toStatus === 'approved'
                            ? 'check_circle'
                            : 'send'
                  }
                  size="sm"
                  className="mt-0.5 text-muted-foreground"
                  aria-hidden
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm">
                    {h.fromStatus
                      ? `${ASSIST_STATUS_LABELS[h.fromStatus]} → ${ASSIST_STATUS_LABELS[h.toStatus]}`
                      : `Submitted as ${ASSIST_STATUS_LABELS[h.toStatus]}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {h.changedBy?.fullName ?? 'System'} ·{' '}
                    {format(h.changedAt, 'PP p')}
                  </p>
                  {h.reason && (
                    <p className="text-xs whitespace-pre-line">{h.reason}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {canTransition && !terminal && (
        <AssistTransitionActions assistId={detail.id} status={detail.status} />
      )}
    </div>
  );
}
