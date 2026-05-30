import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

import { Icon } from '@/components/ui/icon';
import type { AssistRequestRow } from '@/lib/assist/queries';

import { AssistPriorityBadge } from './AssistPriorityBadge';
import { AssistStatusBadge } from './AssistStatusBadge';

interface Props {
  row: AssistRequestRow;
  detailHref: string;
  showExec?: boolean;
}

export function AssistRow({ row, detailHref, showExec = false }: Props) {
  return (
    <li>
      <Link
        href={detailHref}
        className="block rounded-2xl border bg-card p-4 shadow-sm hover:bg-accent/40 transition-colors space-y-2"
      >
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold tracking-tight truncate">
              {row.linkedRequest
                ? `Assist for ${row.linkedRequest.customerName}`
                : 'Assist request'}
            </p>
            <p className="text-xs text-muted-foreground">
              {row.orderNumber ? `Order ${row.orderNumber} · ` : ''}
              {row.itemCount} item{row.itemCount === 1 ? '' : 's'}
              {row.linkedRequest ? ` · ${row.linkedRequest.cityName}` : ''}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <AssistStatusBadge status={row.status} />
            <AssistPriorityBadge priority={row.priority} />
          </div>
        </header>
        <footer className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Icon name="schedule" size="xs" />
            {formatDistanceToNow(row.createdAt, { addSuffix: true })}
          </span>
          {showExec && (
            <span className="inline-flex items-center gap-1">
              <Icon name="person" size="xs" />
              {row.exec.fullName}
            </span>
          )}
          {row.dispatchByDate && (
            <span className="inline-flex items-center gap-1">
              <Icon name="event" size="xs" />
              by {row.dispatchByDate}
            </span>
          )}
        </footer>
      </Link>
    </li>
  );
}
