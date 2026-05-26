'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';

// =============================================================================
// PR11 2026-05-26: debounced search input for /captain/requests/unassigned
// =============================================================================

interface Props {
  initial: string;
}

export function UnassignedSearchInput({ initial }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initial);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed === initial) return;
    const handle = setTimeout(() => {
      const next = new URLSearchParams(searchParams?.toString() ?? '');
      if (trimmed.length > 0) next.set('q', trimmed);
      else next.delete('q');
      next.delete('page'); // any filter change resets to page 1
      const qs = next.toString();
      startTransition(() =>
        router.push(
          qs.length > 0
            ? `/captain/requests/unassigned?${qs}`
            : '/captain/requests/unassigned',
        ),
      );
    }, 300);
    return () => clearTimeout(handle);
  }, [value, initial, router, searchParams]);

  return (
    <div className="relative">
      <Icon
        name="search"
        size="sm"
        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        inputMode="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search by customer name or phone"
        className="h-11 pl-9"
        aria-label="Search unassigned requests"
      />
    </div>
  );
}
