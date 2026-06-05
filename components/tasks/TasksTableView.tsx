import Link from 'next/link';
import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';

import type { TasksTableResult, TasksTableRow } from '@/lib/tasks/tasks-table';

// =============================================================================
// HVA-201 follow-up: TasksTableView — shared table for /captain/tasks +
// /admin/tasks
// =============================================================================
//
// Server-rendered. Sort-direction control lives in TasksTableFilters
// (URL-driven via ?dir=). The header here is non-clickable, just a
// label. Pagination links preserve the current filter state via the
// searchString passed in.
// =============================================================================

interface Props {
  result: TasksTableResult;
  basePath: string;
  searchString: string;
  /** When true, render the Captain column. False on /captain/tasks (it's
   *  always the same captain). */
  showCaptainColumn: boolean;
  /** Optional per-row action cell. When provided, renders an extra
   *  rightmost column with the returned ReactNode. Used by the exec
   *  /tasks page to drop in the "+" action (MoveTaskSheet for
   *  pending/postponed, AddTaskSheet clone for completed). Captain +
   *  admin omit this — they're observational views. */
  renderRowActions?: (row: TasksTableRow) => ReactNode;
}

function formatDate(iso: string): string {
  // YYYY-MM-DD → "5 Jun 2026"
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function statusPill(
  status: 'pending' | 'completed' | 'postponed' | 'cancelled',
) {
  const tone =
    status === 'completed'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
      : status === 'pending'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
        : status === 'postponed'
          ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200'
          : 'bg-slate-100 text-slate-700';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}
    >
      {status}
    </span>
  );
}

export function TasksTableView({
  result,
  basePath,
  searchString,
  showCaptainColumn,
  renderRowActions,
}: Props) {
  const { rows, total, totalPages, page, pageSize, aggregate } = result;
  const fromIdx = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const toIdx = Math.min(page * pageSize, total);

  return (
    <section
      aria-label="Tasks list"
      className="rounded-2xl border bg-card p-4 sm:p-5 space-y-4 shadow-sm"
    >
      {/* Aggregate strip */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <p className="text-[12px] text-muted-foreground tabular-nums">
          {total} match{total === 1 ? '' : 'es'} ·{' '}
          <span className="text-amber-700">{aggregate.pending} pending</span> ·{' '}
          <span className="text-sky-700">{aggregate.postponed} postponed</span> ·{' '}
          <span className="text-emerald-700">{aggregate.completed} completed</span>
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-2xl border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          No tasks match the current filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left py-2.5 px-3">Date</th>
                <th className="text-left py-2.5 px-3">Status</th>
                <th className="text-left py-2.5 px-3">Task</th>
                <th className="text-left py-2.5 px-3">Customer</th>
                <th className="text-left py-2.5 px-3">Executive</th>
                {showCaptainColumn && (
                  <th className="text-left py-2.5 px-3">Captain</th>
                )}
                {renderRowActions && (
                  <th className="text-right py-2.5 px-3">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <TaskRow
                  key={r.id}
                  row={r}
                  showCaptainColumn={showCaptainColumn}
                  actions={renderRowActions ? renderRowActions(r) : null}
                />
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
        total={total}
        basePath={basePath}
        searchString={searchString}
      />
    </section>
  );
}

function TaskRow({
  row,
  showCaptainColumn,
  actions,
}: {
  row: TasksTableRow;
  showCaptainColumn: boolean;
  actions: ReactNode;
}) {
  const completedSecondary =
    row.status === 'completed' && row.completedAt
      ? new Date(row.completedAt).toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })
      : null;

  const postponedHint =
    row.status === 'postponed' && row.postponedToDate
      ? `Scheduled ${formatDate(row.postponedToDate)}`
      : null;

  return (
    <tr className="hover:bg-muted/30">
      <td className="py-3 px-3 align-top whitespace-nowrap">
        <p className="text-sm font-medium tabular-nums">
          {formatDate(row.primaryDate)}
        </p>
        {completedSecondary && (
          <p className="text-[10px] text-muted-foreground tabular-nums">
            {completedSecondary} IST
          </p>
        )}
        {postponedHint && (
          <p className="text-[10px] text-sky-700 tabular-nums">
            {postponedHint}
          </p>
        )}
      </td>
      <td className="py-3 px-3 align-top whitespace-nowrap">
        {statusPill(row.status)}
      </td>
      <td className="py-3 px-3 align-top min-w-[220px]">
        <p className="text-sm font-medium leading-snug">{row.taskType}</p>
        {row.description.trim().length > 0 && (
          <p className="text-[12px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">
            {row.description}
          </p>
        )}
        {row.outcomeName && row.status === 'completed' && (
          <p className="text-[10px] text-emerald-700 mt-0.5">
            Outcome: {row.outcomeName}
            {row.outcomeNotes ? ` — ${row.outcomeNotes}` : ''}
          </p>
        )}
      </td>
      <td className="py-3 px-3 align-top">
        {row.linkedCustomerName ? (
          row.linkRequestId ? (
            <Link
              href={`/requests/${row.linkRequestId}`}
              className="text-[13px] text-primary hover:underline"
            >
              {row.linkedCustomerName}
            </Link>
          ) : (
            <span className="text-[13px]">{row.linkedCustomerName}</span>
          )
        ) : (
          <span className="text-[12px] text-muted-foreground/60">—</span>
        )}
      </td>
      <td className="py-3 px-3 align-top">
        <span className="text-[13px]">{row.execName}</span>
      </td>
      {showCaptainColumn && (
        <td className="py-3 px-3 align-top">
          <span className="text-[12px] text-muted-foreground">
            {row.captainName ?? '—'}
          </span>
        </td>
      )}
      {actions && (
        <td className="py-3 px-3 align-top">
          <div className="flex items-center justify-end">{actions}</div>
        </td>
      )}
    </tr>
  );
}

function Paginator({
  page,
  totalPages,
  fromIdx,
  toIdx,
  total,
  basePath,
  searchString,
}: {
  page: number;
  totalPages: number;
  fromIdx: number;
  toIdx: number;
  total: number;
  basePath: string;
  searchString: string;
}) {
  if (total === 0) return null;
  const params = new URLSearchParams(searchString);
  function hrefFor(p: number) {
    const copy = new URLSearchParams(params);
    if (p === 1) copy.delete('page');
    else copy.set('page', String(p));
    const qs = copy.toString();
    return qs.length > 0 ? `${basePath}?${qs}` : basePath;
  }
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground tabular-nums"
    >
      <span>
        {fromIdx}–{toIdx} of {total}
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
