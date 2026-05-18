'use client';

import { useEffect, useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import { RequestBucketTabs } from '@/components/requests/RequestBucketTabs';
import { RequestCardMobile } from '@/components/requests/RequestCardMobile';
import { RequestsTable } from '@/components/requests/RequestsTable';
import type { RequestRow } from '@/components/requests/types';
import {
  EXEC_BUCKET_LABELS,
  EXEC_REQUEST_BUCKETS,
  categorizeExecRequest,
  countExecRequestsByBucket,
  type ExecRequestBucket,
} from '@/lib/exec/request-buckets';
import { matchesRequestSearch } from '@/lib/exec/request-search';

// =============================================================================
// HVA-65: exec /requests client-side filter
// =============================================================================
//
// Server fetches every request assigned to the current exec; this
// component handles in-memory bucket selection + debounced text search.
//
// Search: 300ms debounce on a single input that matches customer.name OR
// customer.phone, case-insensitive. Phone match strips non-digit
// characters from BOTH sides so "9885 698 665" and "+919885698665" both
// match against "9885698665".
//
// Bucket counts are computed from the unfiltered server result so the
// pill counts don't shift when the user types in the search box (spec
// locked decision 8).
// =============================================================================

interface Props {
  /** ISO-serialised rows so this can be a client island. Date strings get
      re-hydrated for date-fns; the wire never carries Date objects across
      the RSC boundary. */
  rows: SerializedRequestRow[];
}

export interface SerializedRequestRow extends Omit<RequestRow, 'cancelledAt' | 'createdAt'> {
  cancelledAt: string | null;
  createdAt: string;
}

export function RequestsFilterClient({ rows: serialized }: Props) {
  // Re-hydrate Date fields once per render. The serialized props are
  // stable references from the parent so this useMemo's identity
  // matches.
  const rows: RequestRow[] = useMemo(
    () =>
      serialized.map((r) => ({
        ...r,
        cancelledAt: r.cancelledAt === null ? null : new Date(r.cancelledAt),
        createdAt: new Date(r.createdAt),
      })),
    [serialized],
  );

  const [bucket, setBucket] = useState<ExecRequestBucket>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Counts per bucket, derived from the UNFILTERED row set. Locked
  // decision #8: search input does not move the bucket count.
  const counts = useMemo(() => countExecRequestsByBucket(rows), [rows]);

  const visible = useMemo(() => {
    return rows.filter((r) => {
      if (bucket !== 'all' && categorizeExecRequest(r) !== bucket) return false;
      return matchesRequestSearch(r, debouncedSearch);
    });
  }, [rows, bucket, debouncedSearch]);

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

      <RequestBucketTabs buckets={tabs} active={bucket} onSelect={setBucket} />

      {visible.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {debouncedSearch !== ''
              ? `No requests matching "${debouncedSearch}".`
              : `No requests in ${EXEC_BUCKET_LABELS[bucket]}.`}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile cards — below md (768px) breakpoint */}
          <ul className="md:hidden space-y-3" aria-label="Requests (mobile)">
            {visible.map((r) => (
              <li key={r.id}>
                <RequestCardMobile row={r} mode="exec" />
              </li>
            ))}
          </ul>

          {/* Desktop table — md and above */}
          <div className="hidden md:block">
            <RequestsTable rows={visible} mode="exec" />
          </div>
        </>
      )}
    </div>
  );
}
