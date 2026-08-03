import Link from 'next/link';

import { Pagination } from '@/components/lists/Pagination';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import type {
  DispatchQueueSummary,
  QueueRow,
} from '@/lib/support/dispatch-queries';
import { computePageRange } from '@/lib/pagination';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-308: the Dispatch section for exec + captain
// =============================================================================
//
// One centralized, product-level list of everything still to be shipped,
// across every order the viewer owns. This is the "what do I still owe my
// customers" screen — the per-order pill (HVA-305) answers the status of a
// single order; this answers it across all of them at once.
//
// Read-only. Support performs the actual dispatch; exec and captain need
// to know what is outstanding so they can chase it and answer customers.
//
// Server component — filters are plain links, so there is no client
// bundle and no hydration for a screen that is pure reading.
// =============================================================================

const PRIORITY_LABEL: Record<'low' | 'med' | 'high', string> = {
  low: 'Low',
  med: 'Medium',
  high: 'High',
};

const PRIORITY_TONE: Record<'low' | 'med' | 'high', string> = {
  low: 'bg-muted text-muted-foreground',
  med: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  high: 'bg-rose-500/15 text-rose-700 border-rose-500/30',
};

export type DispatchQueueMode = 'pending' | 'in_progress' | 'all';

const MODE_LABEL: Record<DispatchQueueMode, string> = {
  pending: 'Not shipped',
  in_progress: 'Partly shipped',
  all: 'All outstanding',
};

const MODES: DispatchQueueMode[] = ['all', 'pending', 'in_progress'];

interface Props {
  rows: QueueRow[];
  summary: DispatchQueueSummary;
  mode: DispatchQueueMode;
  /** '/dispatch' or '/captain/dispatch'. */
  basePath: string;
  page: number;
  pageSize: number;
  totalCount: number;
  /** Captain/admin see whose order it is; an exec's rows are all their own. */
  showCustomerOwner?: boolean;
  /** Copy under the heading — differs slightly per role. */
  subtitle: string;
}

function hrefFor(basePath: string, mode: DispatchQueueMode): string {
  return mode === 'all' ? basePath : `${basePath}?mode=${mode}`;
}

export function DispatchQueueView({
  rows,
  summary,
  mode,
  basePath,
  page,
  pageSize,
  totalCount,
  subtitle,
}: Props) {
  const range = computePageRange({ total: totalCount, page, pageSize });

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Dispatch</h1>
        <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
      </header>

      {/* Summary — the "clear summary of all the products I have to ship". */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryTile
          value={summary.unitsPending}
          label={summary.unitsPending === 1 ? 'unit pending' : 'units pending'}
          tone="text-amber-700"
        />
        <SummaryTile
          value={summary.productsPending}
          label={summary.productsPending === 1 ? 'product' : 'products'}
        />
        <SummaryTile
          value={summary.ordersPending}
          label={summary.ordersPending === 1 ? 'order' : 'orders'}
        />
      </div>

      {/* Filter chips — plain links, so this stays a server component. */}
      <nav className="flex flex-wrap gap-2" aria-label="Dispatch filter">
        {MODES.map((m) => (
          <Link
            key={m}
            href={hrefFor(basePath, m)}
            aria-current={m === mode ? 'page' : undefined}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              m === mode
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card hover:bg-muted/60',
            )}
          >
            {MODE_LABEL[m]}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center space-y-1">
          <p className="text-sm font-medium">Nothing pending dispatch</p>
          <p className="text-xs text-muted-foreground">
            {mode === 'all'
              ? 'Every product on your confirmed orders has been shipped.'
              : `No products match "${MODE_LABEL[mode]}".`}
          </p>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            Showing {range.from}–{range.to} of {range.total} · most urgent first
          </p>

          {/* Mobile: one card per outstanding product. */}
          <ul className="lg:hidden space-y-3" aria-label="Pending products (mobile)">
            {rows.map((r) => {
              const shipped = r.quantityTotal - r.quantityRemaining;
              return (
                <li key={r.lineItemId}>
                  <Link
                    href={`/requests/${r.requestId}`}
                    className="block rounded-2xl border bg-card p-4 shadow-sm transition-colors hover:bg-muted/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">
                          {r.productName}
                        </p>
                        {r.productSku && (
                          <p className="text-[11px] font-mono text-muted-foreground truncate">
                            {r.productSku}
                          </p>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className={cn('text-[10px] shrink-0', PRIORITY_TONE[r.priority])}
                      >
                        {PRIORITY_LABEL[r.priority]}
                      </Badge>
                    </div>

                    <p className="text-xs mt-2 tabular-nums">
                      <span className="font-semibold text-amber-700">
                        {r.quantityRemaining} pending
                      </span>
                      <span className="text-muted-foreground">
                        {' '}
                        · {shipped} of {r.quantityTotal} shipped
                      </span>
                    </p>

                    <p className="text-[11px] text-muted-foreground mt-1.5 truncate">
                      {r.customerName} · {r.cityName}
                      {r.targetDispatchDate ? ` · target ${r.targetDispatchDate}` : ''}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Desktop: table. */}
          <div className="hidden lg:block rounded-2xl border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Product</th>
                    <th className="text-left px-4 py-3 font-medium">Customer</th>
                    <th className="text-left px-4 py-3 font-medium">City</th>
                    <th className="text-right px-4 py-3 font-medium">Ordered</th>
                    <th className="text-right px-4 py-3 font-medium">Shipped</th>
                    <th className="text-right px-4 py-3 font-medium">Pending</th>
                    <th className="text-left px-4 py-3 font-medium">Priority</th>
                    <th className="text-left px-4 py-3 font-medium">Target</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const shipped = r.quantityTotal - r.quantityRemaining;
                    return (
                      <tr
                        key={r.lineItemId}
                        className="border-t hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/requests/${r.requestId}`}
                            className="font-medium hover:underline"
                          >
                            {r.productName}
                          </Link>
                          {r.productSku && (
                            <div className="text-[11px] font-mono text-muted-foreground">
                              {r.productSku}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/requests/${r.requestId}`}
                            className="hover:underline"
                          >
                            {r.customerName}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {r.cityName}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {r.quantityTotal}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                          {shipped}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-amber-700">
                          {r.quantityRemaining}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={cn('text-[10px]', PRIORITY_TONE[r.priority])}
                          >
                            {PRIORITY_LABEL[r.priority]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {r.targetDispatchDate ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {range.totalPages > 1 && (
            <Pagination
              pathname={basePath}
              page={range.page}
              totalPages={range.totalPages}
              from={range.from}
              to={range.to}
              total={range.total}
            />
          )}
        </>
      )}
    </div>
  );
}

function SummaryTile({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl border bg-card px-4 py-3">
      <p className={cn('text-2xl font-semibold tabular-nums', tone)}>{value}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

/** Shared icon + label for the nav entries, so both portals match. */
export const DISPATCH_NAV_ICON = 'local_shipping';

export function DispatchNavIcon() {
  return <Icon name={DISPATCH_NAV_ICON} size="sm" />;
}
