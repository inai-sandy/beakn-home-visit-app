'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AssistRequestRow } from '@/lib/assist/queries';
import {
  ASSIST_STATUS_LABELS,
  ASSIST_TYPE_LABELS,
  type AssistStatus,
  type AssistType,
} from '@/lib/assist/types';
import { cn } from '@/lib/utils';

import { AssistRow } from './AssistRow';

// HVA-199: shared list-view shell. Used by /assist (exec), /captain/assist,
// /admin/operations/assist. Filter + search + pagination per universal rule.
// Rows grouped by `type` in collapsible accordions, default closed.

interface Props {
  rows: AssistRequestRow[];
  total: number;
  page: number;
  pageSize: number;
  basePath: string; // e.g. '/assist' or '/captain/assist'
  detailPath: string; // e.g. '/assist' (route is `${detailPath}/${id}`)
  showExec?: boolean;
  currentType: AssistType | 'all';
  currentStatus: AssistStatus | 'all';
  currentSearch: string;
}

const ALL_STATUSES: readonly AssistStatus[] = [
  'submitted',
  'approved',
  'processing',
  'dispatched',
  'rejected',
];

const ALL_TYPES: readonly AssistType[] = ['material_request'];

export function AssistListView({
  rows,
  total,
  page,
  pageSize,
  basePath,
  detailPath,
  showExec = false,
  currentType,
  currentStatus,
  currentSearch,
}: Props) {
  const router = useRouter();
  const pathname = usePathname() ?? basePath;
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(currentSearch);
  const [, startTransition] = useTransition();

  function push(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    let nonPage = false;
    for (const [k, v] of Object.entries(updates)) {
      if (k !== 'page') nonPage = true;
      if (v && v.length > 0 && v !== 'all') next.set(k, v);
      else next.delete(k);
    }
    if (nonPage) next.delete('page');
    const qs = next.toString();
    startTransition(() =>
      router.push(qs.length > 0 ? `${pathname}?${qs}` : pathname),
    );
  }

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === currentSearch) return;
    const handle = setTimeout(() => {
      push({ q: trimmed.length > 0 ? trimmed : null });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, currentSearch]);

  // Group rows by type (in case future enum values append).
  const byType = new Map<AssistType, AssistRequestRow[]>();
  for (const row of rows) {
    const list = byType.get(row.type) ?? [];
    list.push(row);
    byType.set(row.type, list);
  }

  // Accordion-closed-by-default per memory rule. Defaults to all-collapsed
  // EXCEPT when filtered to a single type — then expand it so the user sees
  // the rows they filtered for.
  const initialOpen: Record<string, boolean> = {};
  if (currentType !== 'all') initialOpen[currentType] = true;
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(initialOpen);
  function toggle(type: AssistType) {
    setOpenMap((prev) => ({ ...prev, [type]: !prev[type] }));
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <section
        aria-label="Filters"
        className="rounded-3xl border bg-card p-4 shadow-sm space-y-3"
      >
        <div className="flex flex-col lg:flex-row gap-2">
          <div className="relative flex-1">
            <Icon
              name="search"
              size="sm"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              inputMode="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by order number, product, customer"
              className="h-11 pl-9"
              aria-label="Search assists"
            />
          </div>
          <Select
            value={currentType}
            onValueChange={(v) => push({ type: v === 'all' ? null : v })}
          >
            <SelectTrigger className="h-11 lg:w-48" aria-label="Filter by type">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {ALL_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {ASSIST_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={currentStatus}
            onValueChange={(v) => push({ status: v === 'all' ? null : v })}
          >
            <SelectTrigger className="h-11 lg:w-44" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {ALL_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {ASSIST_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {rows.length === 0 ? (
        <section className="rounded-3xl border border-dashed bg-card/40 p-10 text-center text-sm text-muted-foreground">
          No assist requests match the current filters.
        </section>
      ) : (
        <div className="space-y-3">
          {ALL_TYPES.map((type) => {
            const items = byType.get(type) ?? [];
            if (items.length === 0) return null;
            const open = openMap[type] ?? false;
            return (
              <section key={type} className="rounded-3xl border bg-card shadow-sm">
                <button
                  type="button"
                  onClick={() => toggle(type)}
                  aria-expanded={open}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
                    <Icon name="support_agent" size="sm" className="text-primary" />
                    {ASSIST_TYPE_LABELS[type]}
                    <span className="text-xs text-muted-foreground font-normal">
                      ({items.length})
                    </span>
                  </span>
                  <Icon
                    name={open ? 'expand_less' : 'expand_more'}
                    size="sm"
                    className="text-muted-foreground"
                  />
                </button>
                {open && (
                  <ul className="px-3 pb-3 space-y-2">
                    {items.map((row) => (
                      <AssistRow
                        key={row.id}
                        row={row}
                        detailHref={`${detailPath}/${row.id}`}
                        showExec={showExec}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between gap-3 pt-2"
        >
          <Link
            className={cn(
              'inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border',
              page <= 1 && 'pointer-events-none opacity-50',
            )}
            href={buildPageHref(searchParams, pathname, page - 1)}
            aria-disabled={page <= 1}
          >
            <Icon name="chevron_left" size="xs" />
            Previous
          </Link>
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Link
            className={cn(
              'inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border',
              page >= totalPages && 'pointer-events-none opacity-50',
            )}
            href={buildPageHref(searchParams, pathname, page + 1)}
            aria-disabled={page >= totalPages}
          >
            Next
            <Icon name="chevron_right" size="xs" />
          </Link>
        </nav>
      )}
    </div>
  );
}

function buildPageHref(
  searchParams: URLSearchParams | null,
  pathname: string,
  nextPage: number,
): string {
  const next = new URLSearchParams(searchParams?.toString() ?? '');
  if (nextPage <= 1) next.delete('page');
  else next.set('page', String(nextPage));
  const qs = next.toString();
  return qs.length > 0 ? `${pathname}?${qs}` : pathname;
}
