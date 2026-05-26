'use client';

import { useRouter, useSearchParams } from 'next/navigation';
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

// =============================================================================
// PR11 2026-05-26: filters for /captain/calendar
// =============================================================================
//
// Two URL-driven filters on top of the existing view/date selector:
//   - Exec filter (?exec=<userId>|all)
//   - Text search (?q=) — matches customer name + exec name
//
// useTransition for URL pushes, not mutations — useServerMutation
// doesn't apply. The CalendarClient already owns the view/date URL
// state.
// =============================================================================

interface Props {
  team: Array<{ userId: string; fullName: string }>;
  currentExec: string;
  currentSearch: string;
}

export function CalendarFiltersBar({
  team,
  currentExec,
  currentSearch,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [searchInput, setSearchInput] = useState(currentSearch);
  const [, startTransition] = useTransition();

  function pushParam(key: string, value: string | null) {
    const next = new URLSearchParams(params?.toString() ?? '');
    if (value && value.length > 0 && value !== 'all') {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    const qs = next.toString();
    startTransition(() =>
      router.push(qs.length > 0 ? `/captain/calendar?${qs}` : '/captain/calendar'),
    );
  }

  // Debounced search → ?q=
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === currentSearch) return;
    const handle = setTimeout(() => {
      pushParam('q', trimmed.length > 0 ? trimmed : null);
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, currentSearch]);

  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
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
          placeholder="Search customer or exec name"
          className="h-11 pl-9"
          aria-label="Search team calendar"
        />
      </div>
      <Select
        value={currentExec}
        onValueChange={(v) => pushParam('exec', v === 'all' ? null : v)}
      >
        <SelectTrigger className="h-11 sm:w-56" aria-label="Filter by exec">
          <SelectValue placeholder="All execs" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All execs</SelectItem>
          {team.map((t) => (
            <SelectItem key={t.userId} value={t.userId}>
              {t.fullName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
