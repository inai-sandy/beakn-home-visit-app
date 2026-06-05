import Link from 'next/link';

import { Icon } from '@/components/ui/icon';
import { WarningButtons } from '@/components/warnings/WarningButtons';
import { HARD_WARNING_FIRE_THRESHOLD } from '@/lib/warnings/metrics';

import type {
  TargetsTableResult,
  TargetsTableRow,
  TargetsTableSort,
} from '@/lib/admin/targets-table';
import type { TargetMonthWindow } from '@/lib/exec/target-progress';

// =============================================================================
// HVA-229: unified team-targets table
// =============================================================================
//
// Replaces the visual TeamTargetArena + the separate
// AdminExecWarningRoster on /admin/targets. One row per exec, columns:
//
//   Name | Captain | City | Orders% | Revenue% | Combined% | Soft | Hard | Actions
//
// Server-rendered. Sort + page links are URL-driven (?sort=…&dir=…&page=…).
// WarningButtons (client) drops in the rightmost cell.
//
// The aggregate strip + header context lives in the page; this
// component is just the table + paginator + sortable headers.
// =============================================================================

function formatRupeesShort(paise: number): string {
  const rupees = Math.round(paise / 100);
  if (rupees >= 10_000_000) return `₹${(rupees / 10_000_000).toFixed(2)}Cr`;
  if (rupees >= 100_000) return `₹${(rupees / 100_000).toFixed(2)}L`;
  if (rupees >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}K`;
  return `₹${rupees}`;
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function progressBar(
  ratio: number,
  tone: 'orders' | 'revenue',
): { width: string; fill: string } {
  const clamped = Math.max(0, Math.min(1, ratio));
  return {
    width: `${clamped * 100}%`,
    fill:
      tone === 'orders'
        ? 'bg-amber-500'
        : ratio >= 1
          ? 'bg-emerald-500'
          : 'bg-primary',
  };
}

interface SortHeaderProps {
  label: string;
  sortKey: TargetsTableSort;
  currentSort: TargetsTableSort;
  currentDir: 'asc' | 'desc';
  basePath: string;
  searchString: string;
  align?: 'left' | 'right' | 'center';
}

function SortHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  basePath,
  searchString,
  align = 'left',
}: SortHeaderProps) {
  const isActive = sortKey === currentSort;
  const nextDir = isActive && currentDir === 'desc' ? 'asc' : 'desc';
  const params = new URLSearchParams(searchString);
  params.set('sort', sortKey);
  params.set('dir', nextDir);
  params.delete('page');
  const href = `${basePath}?${params.toString()}`;
  return (
    <th
      className={`py-2.5 px-3 ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      }`}
    >
      <Link
        href={href}
        className={`inline-flex items-center gap-1 ${
          isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {label}
        {isActive ? (
          <Icon
            name={currentDir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
            size="xs"
          />
        ) : (
          <Icon
            name="unfold_more"
            size="xs"
            className="opacity-50"
          />
        )}
      </Link>
    </th>
  );
}

interface Props {
  result: TargetsTableResult;
  window: TargetMonthWindow;
  monthlyTargetPaise: number;
  /** Current URL search-string (without '?') so the sort headers + paginator
   *  can preserve the filter state. */
  searchString: string;
  basePath: string;
  currentSort: TargetsTableSort;
  currentDir: 'asc' | 'desc';
}

export function TargetsTableView({
  result,
  window,
  monthlyTargetPaise,
  searchString,
  basePath,
  currentSort,
  currentDir,
}: Props) {
  const { rows, totalRows, totalPages, page, pageSize, aggregate } = result;
  const fromIdx = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const toIdx = Math.min(page * pageSize, totalRows);

  return (
    <section
      aria-label="Team targets table"
      className="rounded-3xl border bg-card p-4 sm:p-5 shadow-sm space-y-4"
    >
      {/* Aggregate strip */}
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-semibold tracking-tight">
            All executives — {window.monthLabel}
          </h2>
          <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
            {totalRows} exec{totalRows === 1 ? '' : 's'} match · target per exec{' '}
            {formatRupeesShort(monthlyTargetPaise)} · {window.daysLeft} day
            {window.daysLeft === 1 ? '' : 's'} left
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          <Aggregate
            label="Total orders"
            value={formatRupeesShort(aggregate.totalOrdersPaise)}
            ratio={
              aggregate.totalTargetPaise > 0
                ? aggregate.totalOrdersPaise / aggregate.totalTargetPaise
                : 0
            }
            tone="orders"
          />
          <Aggregate
            label="Total revenue"
            value={formatRupeesShort(aggregate.totalRevenuePaise)}
            ratio={
              aggregate.totalTargetPaise > 0
                ? aggregate.totalRevenuePaise / aggregate.totalTargetPaise
                : 0
            }
            tone="revenue"
          />
          <Aggregate
            label="Active soft"
            value={aggregate.totalSoft.toString()}
          />
          <Aggregate
            label="Active hard"
            value={aggregate.totalHard.toString()}
            highlightFire={aggregate.fireCount > 0}
            fireCount={aggregate.fireCount}
          />
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-2xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          No executives match the current filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide">
              <tr>
                <SortHeader
                  label="Executive"
                  sortKey="name"
                  currentSort={currentSort}
                  currentDir={currentDir}
                  basePath={basePath}
                  searchString={searchString}
                />
                <th className="py-2.5 px-3 text-left hidden md:table-cell">
                  Captain · City
                </th>
                <SortHeader
                  label="Orders"
                  sortKey="orders"
                  currentSort={currentSort}
                  currentDir={currentDir}
                  basePath={basePath}
                  searchString={searchString}
                />
                <SortHeader
                  label="Revenue"
                  sortKey="revenue"
                  currentSort={currentSort}
                  currentDir={currentDir}
                  basePath={basePath}
                  searchString={searchString}
                />
                <SortHeader
                  label="Combined"
                  sortKey="combined"
                  currentSort={currentSort}
                  currentDir={currentDir}
                  basePath={basePath}
                  searchString={searchString}
                  align="center"
                />
                <SortHeader
                  label="Soft"
                  sortKey="softActive"
                  currentSort={currentSort}
                  currentDir={currentDir}
                  basePath={basePath}
                  searchString={searchString}
                  align="center"
                />
                <SortHeader
                  label="Hard"
                  sortKey="hardActive"
                  currentSort={currentSort}
                  currentDir={currentDir}
                  basePath={basePath}
                  searchString={searchString}
                  align="center"
                />
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <TargetRow key={r.execUserId} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Paginator
        page={page}
        totalPages={totalPages}
        fromIdx={fromIdx}
        toIdx={toIdx}
        totalRows={totalRows}
        searchString={searchString}
        basePath={basePath}
      />
    </section>
  );
}

function Aggregate({
  label,
  value,
  ratio,
  tone,
  highlightFire,
  fireCount,
}: {
  label: string;
  value: string;
  ratio?: number;
  tone?: 'orders' | 'revenue';
  highlightFire?: boolean;
  fireCount?: number;
}) {
  const bar = ratio !== undefined && tone ? progressBar(ratio, tone) : null;
  return (
    <div
      className={`rounded-xl border p-2 ${
        highlightFire ? 'border-rose-400 bg-rose-50/40 dark:bg-rose-950/20' : ''
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={`text-sm font-semibold tabular-nums ${
          highlightFire ? 'text-rose-700' : ''
        }`}
      >
        {value}
        {highlightFire && fireCount !== undefined && fireCount > 0 && (
          <span className="ml-1 text-[10px] font-normal">
            ({fireCount} fire)
          </span>
        )}
      </p>
      {bar && (
        <div className="mt-1 h-1 rounded-full bg-muted/60 overflow-hidden">
          <div
            className={`h-full ${bar.fill}`}
            style={{ width: bar.width }}
          />
        </div>
      )}
      {ratio !== undefined && (
        <p className="text-[10px] tabular-nums text-muted-foreground">
          {pct(ratio)} of target
        </p>
      )}
    </div>
  );
}

function TargetRow({ row }: { row: TargetsTableRow }) {
  const ordersBar = progressBar(row.ordersRatio, 'orders');
  const revenueBar = progressBar(row.revenueRatio, 'revenue');
  const combinedPct = Math.round(row.combinedRatio * 100);
  return (
    <tr className={row.fireFlag ? 'bg-rose-50/40 dark:bg-rose-950/10' : 'hover:bg-muted/30'}>
      <td className="py-3 px-3 align-top">
        <Link
          href={`/admin/settings/organization/executives/${row.execUserId}/warnings`}
          className="text-sm font-medium tracking-tight hover:underline"
        >
          {row.execName}
        </Link>
        {row.fireFlag && (
          <p className="text-[10px] font-semibold text-rose-700 mt-0.5 inline-flex items-center gap-1">
            <Icon name="gpp_bad" size="xs" />
            Eligible for termination
          </p>
        )}
      </td>
      <td className="py-3 px-3 hidden md:table-cell align-top">
        <p className="text-[12px] text-muted-foreground">{row.captainName ?? '—'}</p>
        <p className="text-[10px] text-muted-foreground/80">{row.cityName ?? '—'}</p>
      </td>
      <td className="py-3 px-3 align-top w-[140px]">
        <p className="text-[11px] tabular-nums text-muted-foreground mb-1">
          {formatRupeesShort(row.ordersPaise)} · {pct(row.ordersRatio)}
        </p>
        <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden">
          <div className={`h-full ${ordersBar.fill}`} style={{ width: ordersBar.width }} />
        </div>
      </td>
      <td className="py-3 px-3 align-top w-[140px]">
        <p className="text-[11px] tabular-nums text-muted-foreground mb-1">
          {formatRupeesShort(row.revenuePaise)} · {pct(row.revenueRatio)}
        </p>
        <div className="h-1.5 rounded-full bg-muted/60 overflow-hidden">
          <div className={`h-full ${revenueBar.fill}`} style={{ width: revenueBar.width }} />
        </div>
      </td>
      <td className="py-3 px-3 text-center align-top">
        <span
          className={`inline-flex items-center justify-center min-w-[44px] h-7 px-2 rounded-full text-[12px] font-semibold tabular-nums ${
            combinedPct >= 100
              ? 'bg-emerald-100 text-emerald-800'
              : combinedPct >= 60
                ? 'bg-amber-100 text-amber-800'
                : 'bg-rose-100 text-rose-800'
          }`}
        >
          {combinedPct}%
        </span>
      </td>
      <td className="py-3 px-3 text-center align-top">
        {row.softActive > 0 ? (
          <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full bg-amber-100 text-amber-800 text-[12px] font-semibold tabular-nums">
            {row.softActive}
          </span>
        ) : (
          <span className="text-muted-foreground/50 text-[12px]">—</span>
        )}
      </td>
      <td className="py-3 px-3 text-center align-top">
        {row.hardActive > 0 ? (
          <span
            className={`inline-flex items-center justify-center min-w-[36px] h-6 px-2 rounded-full text-[12px] font-semibold tabular-nums ${
              row.fireFlag ? 'bg-rose-600 text-white' : 'bg-rose-100 text-rose-800'
            }`}
          >
            {row.hardActive}/{HARD_WARNING_FIRE_THRESHOLD}
          </span>
        ) : (
          <span className="text-muted-foreground/50 text-[12px]">—</span>
        )}
      </td>
      <td className="py-3 px-3 align-top">
        <div className="flex items-center justify-end">
          <WarningButtons
            execUserId={row.execUserId}
            execName={row.execName}
            captainName={row.captainName}
            currentHardCount={row.hardActive}
            variant="compact"
          />
        </div>
      </td>
    </tr>
  );
}

function Paginator({
  page,
  totalPages,
  fromIdx,
  toIdx,
  totalRows,
  searchString,
  basePath,
}: {
  page: number;
  totalPages: number;
  fromIdx: number;
  toIdx: number;
  totalRows: number;
  searchString: string;
  basePath: string;
}) {
  if (totalRows === 0) return null;
  const params = new URLSearchParams(searchString);
  function hrefFor(p: number): string {
    const copy = new URLSearchParams(params);
    if (p === 1) copy.delete('page');
    else copy.set('page', String(p));
    const qs = copy.toString();
    return qs.length > 0 ? `${basePath}?${qs}` : basePath;
  }
  return (
    <nav
      className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground tabular-nums"
      aria-label="Pagination"
    >
      <span>
        {fromIdx}–{toIdx} of {totalRows}
      </span>
      <span className="flex items-center gap-1">
        {page > 1 ? (
          <Link
            href={hrefFor(page - 1)}
            className="inline-flex items-center gap-0.5 rounded-md border px-2 py-1 hover:bg-accent"
          >
            <Icon name="chevron_left" size="xs" />
            Prev
          </Link>
        ) : (
          <span className="inline-flex items-center gap-0.5 rounded-md border px-2 py-1 opacity-50">
            <Icon name="chevron_left" size="xs" />
            Prev
          </span>
        )}
        <span className="px-2">
          Page {page} / {totalPages}
        </span>
        {page < totalPages ? (
          <Link
            href={hrefFor(page + 1)}
            className="inline-flex items-center gap-0.5 rounded-md border px-2 py-1 hover:bg-accent"
          >
            Next
            <Icon name="chevron_right" size="xs" />
          </Link>
        ) : (
          <span className="inline-flex items-center gap-0.5 rounded-md border px-2 py-1 opacity-50">
            Next
            <Icon name="chevron_right" size="xs" />
          </span>
        )}
      </span>
    </nav>
  );
}
