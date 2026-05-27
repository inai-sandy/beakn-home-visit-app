'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { Icon } from '@/components/ui/icon';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { FinanceListSort } from '@/lib/captain/finance-queries';

// =============================================================================
// PR12-FIX4 2026-05-27: sort selector for the finance order list
// =============================================================================
//
// Sandeep walk: "For orders and quotations table we need sort by date."
// Four options total:
//   - Outstanding desc  (default — biggest money chase first)
//   - Newest first
//   - Oldest first
//   - Order value desc
// =============================================================================

const SORT_LABELS: Record<FinanceListSort, string> = {
  outstanding_desc: 'Outstanding (desc)',
  date_desc: 'Newest first',
  date_asc: 'Oldest first',
  value_desc: 'Order value (desc)',
};

interface Props {
  currentSort: FinanceListSort;
  /** PR13 2026-05-27: customizable basePath for the exec finance page. */
  basePath?: string;
}

export function FinanceListSortToggle({
  currentSort,
  basePath = '/captain/collections',
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function setSort(next: FinanceListSort) {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (next === 'outstanding_desc') params.delete('sort');
    else params.set('sort', next);
    params.delete('page'); // reset to page 1 on sort change
    const qs = params.toString();
    startTransition(() =>
      router.push(qs.length > 0 ? `${basePath}?${qs}` : basePath),
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5 text-xs">
      <Icon
        name="sort"
        size="xs"
        className="text-muted-foreground"
        aria-hidden
      />
      <Select
        value={currentSort}
        onValueChange={(v) => setSort(v as FinanceListSort)}
      >
        <SelectTrigger
          className="h-8 w-40 text-xs"
          aria-label="Sort orders + quotations"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(SORT_LABELS) as FinanceListSort[]).map((key) => (
            <SelectItem key={key} value={key}>
              {SORT_LABELS[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
