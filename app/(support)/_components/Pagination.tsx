'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

// =============================================================================
// HVA-246: Shared pagination control for support list pages
// =============================================================================

interface Props {
  page: number;
  pageSize: number;
  totalCount: number;
}

export function Pagination({ page, pageSize, totalCount }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // eslint-disable-next-line no-restricted-syntax -- URL push
  const [isPending, startTransition] = useTransition();

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  function gotoPage(p: number) {
    const next = new URLSearchParams(params.toString());
    if (p > 1) next.set('page', String(p));
    else next.delete('page');
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  if (totalPages <= 1) {
    return (
      <p className="text-xs text-muted-foreground">
        {totalCount} {totalCount === 1 ? 'row' : 'rows'}
      </p>
    );
  }

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  return (
    <div className="flex items-center justify-between gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => gotoPage(page - 1)}
        disabled={page <= 1 || isPending}
      >
        <Icon name="chevron_left" size="xs" />
        <span>Previous</span>
      </Button>
      <span className="text-xs text-muted-foreground">
        {start}–{end} of {totalCount} · page {page} of {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => gotoPage(page + 1)}
        disabled={page >= totalPages || isPending}
      >
        <span>Next</span>
        <Icon name="chevron_right" size="xs" />
      </Button>
    </div>
  );
}
