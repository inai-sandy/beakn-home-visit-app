import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { maskCustomerPhone } from '@/lib/format/phone';

import { RequestStatusBadge } from './RequestStatusBadge';
import type { RequestRow, RequestsViewMode } from './types';

// =============================================================================
// HVA-65: shared desktop table for request rows
// =============================================================================
//
// Captain mode (7 columns):
//   Customer | Phone (masked) | City | Status | Assigned exec | Submitted | Action
//
// Exec mode (5 columns):
//   Customer | Phone (tel: link) | City | Status | Submitted
//
// The two modes share the table shell + per-row primitives. Captain-only
// columns are omitted entirely in exec mode (no empty cells, no width
// rebalancing surprises). Inline-assign actions plug in via
// `renderActions` — captain page passes a callback that returns the
// HVA-139 button for qualifying rows.
// =============================================================================

interface Props {
  rows: RequestRow[];
  mode: RequestsViewMode;
  /** Captain-only inline-action slot. Omit to skip the Action column entirely. */
  renderActions?: (row: RequestRow) => ReactNode;
}

export function RequestsTable({ rows, mode, renderActions }: Props) {
  const showExecColumn = mode === 'captain';
  const showActionColumn = mode === 'captain' && renderActions !== undefined;

  return (
    <div
      className="rounded-2xl border bg-card overflow-hidden"
      aria-label="Requests (desktop)"
    >
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-3 font-medium">Customer</th>
            <th className="text-left px-4 py-3 font-medium">Phone</th>
            <th className="text-left px-4 py-3 font-medium">City</th>
            <th className="text-left px-4 py-3 font-medium">Status</th>
            {showExecColumn && (
              <th className="text-left px-4 py-3 font-medium">Assigned exec</th>
            )}
            <th className="text-left px-4 py-3 font-medium">Submitted</th>
            {showActionColumn && (
              <th className="text-left px-4 py-3 font-medium">Action</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const action = renderActions?.(row) ?? null;
            return (
              <tr
                key={row.id}
                className="border-t hover:bg-muted/30 transition-colors"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/requests/${row.id}`}
                    className="font-medium hover:underline"
                  >
                    {row.customerName}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  {mode === 'captain' ? (
                    <span className="text-muted-foreground">
                      {maskCustomerPhone(row.customerPhone)}
                    </span>
                  ) : (
                    <a
                      href={`tel:${row.customerPhone}`}
                      className="inline-flex items-center gap-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                      aria-label={`Call ${row.customerName} at ${row.customerPhone}`}
                    >
                      <Icon name="phone" size="xs" />
                      {row.customerPhone}
                    </a>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{row.cityName}</td>
                <td className="px-4 py-3">
                  <RequestStatusBadge row={row} />
                </td>
                {showExecColumn && (
                  <td className="px-4 py-3 text-muted-foreground">
                    {row.assignedExecName ?? (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </td>
                )}
                <td className="px-4 py-3 text-muted-foreground">
                  <span title={row.createdAt.toISOString()}>
                    {formatDistanceToNow(row.createdAt, { addSuffix: true })}
                  </span>
                </td>
                {showActionColumn && <td className="px-4 py-3">{action}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
