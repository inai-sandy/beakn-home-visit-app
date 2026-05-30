'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

import type { PageRange } from '@/lib/pagination';

// =============================================================================
// PR12 2026-05-26: finance list prev/next nav
// =============================================================================

interface Props {
  pageRange: PageRange;
  /** PR13 2026-05-27: customizable for the exec finance page (/finance). */
  basePath?: string;
}

export function FinanceListPaginationNav({
  pageRange,
  basePath = '/captain/collections',
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // eslint-disable-next-line no-restricted-syntax -- HVA-149: URL push for pagination, not a mutation
  const [, startTransition] = useTransition();

  function go(toPage: number) {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if (toPage <= 1) next.delete('page');
    else next.set('page', String(toPage));
    const qs = next.toString();
    startTransition(() =>
      router.push(qs.length > 0 ? `${basePath}?${qs}` : basePath),
    );
  }

  return (
    <nav
      className="flex items-center justify-between gap-2"
      aria-label="Finance list pagination"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => go(pageRange.page - 1)}
        disabled={pageRange.page <= 1}
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
        onClick={() => go(pageRange.page + 1)}
        disabled={pageRange.page >= pageRange.totalPages}
      >
        Next
        <Icon name="chevron_right" size="xs" />
      </Button>
    </nav>
  );
}
