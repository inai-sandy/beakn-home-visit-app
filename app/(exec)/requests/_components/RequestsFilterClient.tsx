'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { RequestBucketTabs } from '@/components/requests/RequestBucketTabs';
import { RequestCardMobile } from '@/components/requests/RequestCardMobile';
import { RequestsTable } from '@/components/requests/RequestsTable';
import type { RequestRow } from '@/components/requests/types';
import {
  EXEC_BUCKET_LABELS,
  EXEC_REQUEST_BUCKETS,
  type ExecRequestBucket,
} from '@/lib/exec/request-buckets';
import type { PageRange } from '@/lib/pagination';

// =============================================================================
// HVA-65 + 2026-05-26: server-side pagination wrapper
// =============================================================================
//
// All filter state lives in URL params (`?page=`, `?q=`, `?bucket=`).
// Server query in page.tsx returns pre-filtered rows; this component
// just renders + pushes URL changes (debounced for search).
// =============================================================================

interface Props {
  rows: SerializedRequestRow[];
  counts: Record<ExecRequestBucket, number>;
  currentBucket: ExecRequestBucket;
  currentSearch: string;
  pageRange: PageRange;
}

export interface SerializedRequestRow extends Omit<RequestRow, 'cancelledAt' | 'createdAt'> {
  cancelledAt: string | null;
  createdAt: string;
}

export function RequestsFilterClient({
  rows: serialized,
  counts,
  currentBucket,
  currentSearch,
  pageRange,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(currentSearch);
  // eslint-disable-next-line no-restricted-syntax -- HVA-149: URL push, not a mutation
  const [isPending, startTransition] = useTransition();

  const rows: RequestRow[] = useMemo(
    () =>
      serialized.map((r) => ({
        ...r,
        cancelledAt: r.cancelledAt === null ? null : new Date(r.cancelledAt),
        createdAt: new Date(r.createdAt),
      })),
    [serialized],
  );

  function buildHref(overrides: {
    q?: string | null;
    bucket?: ExecRequestBucket | null;
    page?: number | null;
  }): string {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if ('q' in overrides) {
      if (overrides.q && overrides.q.length > 0) next.set('q', overrides.q);
      else next.delete('q');
    }
    if ('bucket' in overrides) {
      if (overrides.bucket && overrides.bucket !== 'all') {
        next.set('bucket', overrides.bucket);
      } else {
        next.delete('bucket');
      }
    }
    if ('page' in overrides) {
      if (overrides.page && overrides.page > 1) {
        next.set('page', String(overrides.page));
      } else {
        next.delete('page');
      }
    } else {
      // Any non-page change resets to page 1.
      if (
        Object.keys(overrides).some((k) => k !== 'page') &&
        overrides.page === undefined
      ) {
        next.delete('page');
      }
    }
    const qs = next.toString();
    return qs.length > 0 ? `/requests?${qs}` : '/requests';
  }

  // Debounced search → URL.
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === currentSearch) return;
    const handle = setTimeout(() => {
      startTransition(() => router.push(buildHref({ q: trimmed || null })));
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, currentSearch]);

  function setBucket(b: ExecRequestBucket) {
    startTransition(() => router.push(buildHref({ bucket: b })));
  }

  function goToPage(p: number) {
    startTransition(() => router.push(buildHref({ page: p })));
  }

  const tabs = useMemo(
    () =>
      EXEC_REQUEST_BUCKETS.map((k) => ({
        key: k,
        label: EXEC_BUCKET_LABELS[k],
        count: counts[k],
      })),
    [counts],
  );

  return (
    <div className="space-y-4">
      <Input
        type="search"
        inputMode="search"
        placeholder="Search by customer name or phone"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="h-11"
        aria-label="Search requests"
      />

      <RequestBucketTabs
        buckets={tabs}
        active={currentBucket}
        onSelect={setBucket}
      />

      <p className="text-[11px] text-muted-foreground">
        {pageRange.total === 0
          ? 'No requests match the current filter.'
          : `Showing ${pageRange.from}–${pageRange.to} of ${pageRange.total}`}
      </p>

      {rows.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {currentSearch !== ''
              ? `No requests matching "${currentSearch}".`
              : `No requests in ${EXEC_BUCKET_LABELS[currentBucket]}.`}
          </p>
        </div>
      ) : (
        <>
          <ul className="md:hidden space-y-3" aria-label="Requests (mobile)">
            {rows.map((r) => (
              <li key={r.id}>
                <RequestCardMobile row={r} mode="exec" />
              </li>
            ))}
          </ul>

          <div className="hidden md:block">
            <RequestsTable rows={rows} mode="exec" />
          </div>
        </>
      )}

      {pageRange.totalPages > 1 && (
        <nav
          className="flex items-center justify-between gap-2 pt-2"
          aria-label="Pagination"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => goToPage(pageRange.page - 1)}
            disabled={pageRange.page <= 1 || isPending}
          >
            <Icon name="chevron_left" size="xs" />
            Previous
          </Button>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            Page {pageRange.page} of {pageRange.totalPages}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => goToPage(pageRange.page + 1)}
            disabled={pageRange.page >= pageRange.totalPages || isPending}
          >
            Next
            <Icon name="chevron_right" size="xs" />
          </Button>
        </nav>
      )}
    </div>
  );
}
