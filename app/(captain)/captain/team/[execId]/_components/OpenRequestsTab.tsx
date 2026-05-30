import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import type { ExecOpenRequestRow } from '@/lib/captain/exec-drill-queries';

interface Props {
  rows: ExecOpenRequestRow[];
}

export function OpenRequestsTab({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-8 text-center">
        <Icon
          name="check_circle"
          size="lg"
          className="text-muted-foreground/60 mx-auto"
        />
        <p className="mt-3 text-sm text-muted-foreground">
          No open requests. This exec has no active assignments.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.id}>
          <Link
            href={`/requests/${r.id}`}
            className="block rounded-2xl border bg-card p-4 hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold tracking-tight min-w-0 truncate">
                {r.customerName}
              </p>
              <Badge variant="outline" className="text-[10px] shrink-0">
                {r.stageName}
              </Badge>
            </div>
            <div className="text-[11px] text-muted-foreground capitalize mt-1 break-words">
              {r.cityName}
              {' · '}
              <span className="font-mono">{r.customerPhone}</span>
              {' · raised '}
              {formatDistanceToNow(r.createdAt, { addSuffix: true })}
              {r.visitScheduledAt && (
                <>
                  {' · visit '}
                  {formatDistanceToNow(r.visitScheduledAt, { addSuffix: true })}
                </>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
