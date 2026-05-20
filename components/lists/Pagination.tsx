'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { buildListUrl } from '@/lib/pagination';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-153: pagination control shared by /captain/requests, /captain/contacts,
//          /leads.
// =============================================================================
//
// Three-element strip:
//
//   "Showing 21–40 of 137"          [<] page 2 of 7 [>]
//
// Stays server-driven via URL params — every click flips `?page=N` and
// preserves the rest of the search state. `buildListUrl` already handles
// the "default page=1 is implicit" cleanup.
// =============================================================================

interface PaginationProps {
  pathname: string;
  page: number;
  totalPages: number;
  from: number;
  to: number;
  total: number;
}

export function Pagination({
  pathname,
  page,
  totalPages,
  from,
  to,
  total,
}: PaginationProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  if (total === 0) return null;

  const canPrev = page > 1;
  const canNext = page < totalPages;

  function go(nextPage: number) {
    if (nextPage < 1 || nextPage > totalPages) return;
    router.push(buildListUrl(pathname, searchParams, { page: nextPage }));
  }

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3 flex-wrap"
    >
      <p className="text-xs text-muted-foreground">
        Showing <span className="font-medium text-foreground">{from}</span>–
        <span className="font-medium text-foreground">{to}</span> of{' '}
        <span className="font-medium text-foreground">{total}</span>
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => go(page - 1)}
          disabled={!canPrev}
          aria-label="Previous page"
          className="h-8 w-8 p-0"
        >
          <Icon name="chevron_left" size="sm" />
        </Button>
        <span
          aria-live="polite"
          className={cn(
            'text-xs px-2 tabular-nums',
            totalPages === 1 && 'text-muted-foreground',
          )}
        >
          Page {page} of {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => go(page + 1)}
          disabled={!canNext}
          aria-label="Next page"
          className="h-8 w-8 p-0"
        >
          <Icon name="chevron_right" size="sm" />
        </Button>
      </div>
    </nav>
  );
}
