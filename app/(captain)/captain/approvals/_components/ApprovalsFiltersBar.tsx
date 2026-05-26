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
// PR11 2026-05-26: filters for /captain/approvals
// =============================================================================
//
// Search (customer name, debounced 300ms) + exec filter dropdown.
// Pure URL push — useTransition is the correct shape here (URL nav,
// not a mutation).
// =============================================================================

interface Props {
  team: Array<{ userId: string; fullName: string }>;
  currentExec: string;
  currentSearch: string;
}

export function ApprovalsFiltersBar({
  team,
  currentExec,
  currentSearch,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [searchInput, setSearchInput] = useState(currentSearch);
  const [, startTransition] = useTransition();

  function pushParams(updates: Record<string, string | null>) {
    const next = new URLSearchParams(params?.toString() ?? '');
    let touchedFilter = false;
    for (const [k, v] of Object.entries(updates)) {
      if (k !== 'page') touchedFilter = true;
      if (v && v.length > 0 && v !== 'all') next.set(k, v);
      else next.delete(k);
    }
    // Reset to page 1 when any non-page filter changes.
    if (touchedFilter) next.delete('page');
    const qs = next.toString();
    startTransition(() =>
      router.push(
        qs.length > 0 ? `/captain/approvals?${qs}` : '/captain/approvals',
      ),
    );
  }

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === currentSearch) return;
    const handle = setTimeout(() => {
      pushParams({ q: trimmed.length > 0 ? trimmed : null });
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
          placeholder="Search customer name"
          className="h-11 pl-9"
          aria-label="Search approvals"
        />
      </div>
      <Select
        value={currentExec}
        onValueChange={(v) => pushParams({ exec: v === 'all' ? null : v })}
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
