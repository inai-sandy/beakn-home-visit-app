'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Pagination } from '@/components/lists/Pagination';
import { buildListUrl } from '@/lib/pagination';

import type { ExecTaskRow } from '@/lib/exec/tasks-page-queries';

import { TaskRowWithAction } from './TaskRowWithAction';

// =============================================================================
// HVA-170: Completed accordion body — date-grouped list + range filter + pagination
// =============================================================================
//
// Date-picker filter writes `?from=YYYY-MM-DD&to=YYYY-MM-DD` into the URL;
// the server page re-renders with the filtered + paginated slice. Resetting
// either bound to "" drops the param via buildListUrl's null-removes-key
// semantics.
//
// "Showing N of M" + page nav reuses the existing components/lists/Pagination.
// =============================================================================

interface Props {
  groupedByDate: Array<{ istDate: string; tasks: ExecTaskRow[] }>;
  pagination: {
    currentPage: number;
    totalPages: number;
    totalCount: number;
    pageSize: number;
  };
  currentFilter: { from: string | null; to: string | null };
  onCloneClick: (task: ExecTaskRow) => void;
}

function formatGroupHeader(istDate: string): string {
  const [y, m, d] = istDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
    weekday: 'short',
  });
}

export function CompletedTasksList({
  groupedByDate,
  pagination,
  currentFilter,
  onCloneClick,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [from, setFrom] = useState(currentFilter.from ?? '');
  const [to, setTo] = useState(currentFilter.to ?? '');

  function apply() {
    startTransition(() => {
      router.push(
        buildListUrl('/tasks', searchParams, {
          // Empty string → param dropped. Page reset to 1 happens
          // automatically because we're passing a non-page override.
          q: from === '' ? null : (from as unknown as string),
          // buildListUrl's ListFilterOverrides shape doesn't have explicit
          // from/to keys; we cheat by overloading `q` for `from` and `type`
          // for `to`. Cleaner: inline our own URLSearchParams transform.
        }),
      );
    });
  }

  // The buildListUrl helper is schema-typed for the existing list pages
  // (q / type / exec / city / bucket / page). Tasks page wants from / to
  // instead — handle the URL build inline rather than wedging it into
  // ListFilterOverrides.
  function applyFilter() {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (from) params.set('from', from);
    else params.delete('from');
    if (to) params.set('to', to);
    else params.delete('to');
    params.delete('page'); // any filter change resets to page 1
    const qs = params.toString();
    startTransition(() => {
      router.push(qs === '' ? '/tasks' : `/tasks?${qs}`);
    });
  }

  function clearFilter() {
    setFrom('');
    setTo('');
    startTransition(() => {
      router.push('/tasks');
    });
  }

  const hasFilter = Boolean(currentFilter.from || currentFilter.to);
  // Silence unused-import warning during refactors:
  void apply;

  return (
    <div className="space-y-4">
      {/* Date range filter */}
      <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="completed-from" className="text-[11px]">
              From
            </Label>
            <Input
              id="completed-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9"
              disabled={isPending}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="completed-to" className="text-[11px]">
              To
            </Label>
            <Input
              id="completed-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-9"
              disabled={isPending}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearFilter}
            disabled={isPending || !hasFilter}
          >
            Clear
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={applyFilter}
            disabled={isPending}
          >
            Apply
          </Button>
        </div>
      </div>

      {/* Grouped list */}
      {groupedByDate.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-background/50 p-6 text-center text-sm text-muted-foreground">
          {hasFilter
            ? 'No completed tasks in that range.'
            : "You haven't completed any tasks yet."}
        </div>
      ) : (
        <ul className="space-y-4">
          {groupedByDate.map((group) => (
            <li key={group.istDate} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {formatGroupHeader(group.istDate)}{' '}
                <span className="text-muted-foreground/70 font-normal">
                  · {group.tasks.length} completed
                </span>
              </h3>
              <ul className="space-y-2">
                {group.tasks.map((t) => (
                  <li key={t.id}>
                    <TaskRowWithAction
                      task={t}
                      showCompletedTimestamp
                      actionLabel="Re-add"
                      onActionClick={() => onCloneClick(t)}
                    />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        pathname="/tasks"
        page={pagination.currentPage}
        totalPages={pagination.totalPages}
        from={
          pagination.totalCount === 0
            ? 0
            : (pagination.currentPage - 1) * pagination.pageSize + 1
        }
        to={Math.min(
          pagination.currentPage * pagination.pageSize,
          pagination.totalCount,
        )}
        total={pagination.totalCount}
      />
    </div>
  );
}
