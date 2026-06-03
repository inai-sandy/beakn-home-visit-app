'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';

// =============================================================================
// Reports filter bar — date range + search
// =============================================================================
//
// URL-driven. Date inputs push `?from` / `?to` synchronously. Search
// is debounced (300ms) like the captain Requests filter.
//
// The captain/exec/city dropdowns are surfaced here only at the
// admin /admin/reports/* surfaces. For the captain + exec mirrors we
// reuse the same bar but the parent page hides the dropdowns it
// doesn't need (TODO Sprint 2 — Sprint 1 keeps it simple).
// =============================================================================

interface Props {
  fromDate: string;
  toDate: string;
  captainUserId: string;
  execUserId: string;
  cityId: string;
  search: string;
  basePath: string;
}

export function ReportFiltersBar({
  fromDate,
  toDate,
  search,
  basePath,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [searchValue, setSearchValue] = useState(search);

  // Debounced search
  useEffect(() => {
    const trimmed = searchValue.trim();
    if (trimmed === search) return;
    const handle = setTimeout(() => {
      const next = new URLSearchParams(params?.toString() ?? '');
      if (trimmed.length > 0) next.set('q', trimmed);
      else next.delete('q');
      next.delete('page');
      const qs = next.toString();
      router.push(qs.length > 0 ? `${basePath}?${qs}` : basePath);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchValue, search, router, params, basePath]);

  function pushDate(field: 'from' | 'to', value: string) {
    const next = new URLSearchParams(params?.toString() ?? '');
    next.set(field, value);
    next.delete('page');
    router.push(`${basePath}?${next.toString()}`);
  }

  return (
    <section
      aria-label="Filters"
      className="rounded-2xl border bg-card p-3 grid grid-cols-1 sm:grid-cols-3 gap-3"
    >
      <label className="space-y-1">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          From date (IST)
        </span>
        <Input
          type="date"
          value={fromDate}
          onChange={(e) => pushDate('from', e.target.value)}
          className="h-10"
        />
      </label>
      <label className="space-y-1">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          To date (IST)
        </span>
        <Input
          type="date"
          value={toDate}
          onChange={(e) => pushDate('to', e.target.value)}
          className="h-10"
        />
      </label>
      <label className="space-y-1">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Search
        </span>
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
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Customer, city, exec…"
            className="h-10 pl-9"
            aria-label="Search rows"
          />
        </div>
      </label>
    </section>
  );
}
