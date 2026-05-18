import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { maskCustomerPhone } from '@/lib/format/phone';

import { RequestStatusBadge } from './RequestStatusBadge';
import type { RequestRow, RequestsViewMode } from './types';

// =============================================================================
// HVA-65: shared mobile card for request rows
// =============================================================================
//
// One card component, two modes:
//
//   * captain — phone is masked (HVA-127 maskCustomerPhone), assigned-exec
//     line shown below the city, optional inline-assign action button
//     slots in via `renderActions` (HVA-139).
//
//   * exec — phone is a tel: link with the raw number (exec calls the
//     customer directly), no assigned-exec line (every row is the
//     current user), no action slot.
//
// Stretched-link pattern (absolute Link covering the whole card) keeps
// the entire surface tappable while still allowing phone-call taps in
// exec mode to escape via pointer-events-auto.
// =============================================================================

interface Props {
  row: RequestRow;
  mode: RequestsViewMode;
  /** Captain-only inline-action slot (HVA-139 inline assign). Returns null to skip. */
  renderActions?: (row: RequestRow) => ReactNode;
}

export function RequestCardMobile({ row, mode, renderActions }: Props) {
  const action = renderActions?.(row) ?? null;

  return (
    <div className="relative rounded-2xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring">
      <Link
        href={`/requests/${row.id}`}
        className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none"
        aria-label={`Open request from ${row.customerName}`}
      />
      <div className="relative z-20 pointer-events-none">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold tracking-tight">
            {row.customerName}
          </h3>
          <RequestStatusBadge row={row} />
        </div>

        {mode === 'exec' && (
          <div className="mt-1.5">
            <Badge variant="secondary" className="text-[10px]">
              {row.cityName}
            </Badge>
          </div>
        )}

        {mode === 'captain' ? (
          <p className="text-xs font-mono text-muted-foreground mt-1">
            {maskCustomerPhone(row.customerPhone)}
          </p>
        ) : (
          <p className="text-xs mt-1">
            {/* pointer-events-auto re-enables hit-testing for the tel:
                link so a tap on the phone dials instead of navigating. */}
            <a
              href={`tel:${row.customerPhone}`}
              className="pointer-events-auto inline-flex items-center gap-1 font-mono text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              aria-label={`Call ${row.customerName} at ${row.customerPhone}`}
            >
              <Icon name="phone" size="xs" />
              {row.customerPhone}
            </a>
          </p>
        )}

        {mode === 'captain' && (
          <div className="flex items-center justify-between gap-2 mt-2 text-xs text-muted-foreground">
            <span>{row.cityName}</span>
            <span>{row.assignedExecName ?? '—'}</span>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground mt-1">
          {formatDistanceToNow(row.createdAt, { addSuffix: true })}
        </p>

        {action !== null && (
          <div className="mt-3 flex justify-end pointer-events-auto">{action}</div>
        )}
      </div>
    </div>
  );
}
