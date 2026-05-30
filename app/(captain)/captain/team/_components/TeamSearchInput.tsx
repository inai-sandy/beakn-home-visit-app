'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';

// =============================================================================
// 2026-05-26: search input for /captain/team
// =============================================================================
//
// Debounced (300ms) name + phone search. Pushes `?q=` into the URL and
// lets the server query do the actual filtering — same pattern used on
// /captain/contacts and /captain/requests. useTransition is the correct
// shape here (URL push, not a mutation) — useServerMutation does not
// apply.
// =============================================================================

interface Props {
  initial: string;
}

export function TeamSearchInput({ initial }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initial);
  // eslint-disable-next-line no-restricted-syntax -- HVA-149: URL push for search debounce, not a mutation
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed === initial) return;
    const handle = setTimeout(() => {
      const next = new URLSearchParams(searchParams?.toString() ?? '');
      if (trimmed.length > 0) next.set('q', trimmed);
      else next.delete('q');
      const qs = next.toString();
      startTransition(() =>
        router.push(qs.length > 0 ? `/captain/team?${qs}` : '/captain/team'),
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
        placeholder="Search by name or phone"
        className="h-11 pl-9"
        aria-label="Search team"
        aria-busy={isPending}
      />
    </div>
  );
}
