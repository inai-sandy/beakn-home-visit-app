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
// HVA-229: filter chip strip above the unified targets table
// =============================================================================
//
// URL-driven. Search debounces (300ms). Dropdowns push immediately.
// Resetting one field clears ?page so we land on page 1.
// =============================================================================

interface Props {
  q: string;
  captainId: string;
  cityName: string;
  status: string;
  captainFacets: Array<{ id: string; name: string }>;
  cityFacets: string[];
  basePath: string;
}

export function TargetsTableFilters({
  q,
  captainId,
  cityName,
  status,
  captainFacets,
  cityFacets,
  basePath,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [searchValue, setSearchValue] = useState(q);

  // Debounced search.
  useEffect(() => {
    const trimmed = searchValue.trim();
    if (trimmed === q) return;
    const handle = setTimeout(() => {
      const next = new URLSearchParams(params?.toString() ?? '');
      if (trimmed.length > 0) next.set('q', trimmed);
      else next.delete('q');
      next.delete('page');
      const qs = next.toString();
      startTransition(() => {
        router.push(qs.length > 0 ? `${basePath}?${qs}` : basePath);
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [searchValue, q, router, params, basePath]);

  function pushParam(key: string, value: string | null) {
    const next = new URLSearchParams(params?.toString() ?? '');
    if (value && value !== 'all') {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    next.delete('page');
    const qs = next.toString();
    startTransition(() => {
      router.push(qs.length > 0 ? `${basePath}?${qs}` : basePath);
    });
  }

  const anyActive =
    searchValue.trim().length > 0 ||
    captainId !== 'all' ||
    cityName !== 'all' ||
    status !== 'all';

  function clearAll() {
    setSearchValue('');
    startTransition(() => {
      router.push(basePath);
    });
  }

  return (
    <section
      aria-label="Filters"
      className="rounded-2xl border bg-card p-3 sm:p-4 flex flex-col gap-3"
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Icon
            name="search"
            size="xs"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            aria-hidden
          />
          <Input
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search by exec, captain, or city…"
            className="h-9 pl-9 text-sm"
            aria-label="Search executives"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={captainId}
            onValueChange={(v) => pushParam('captain', v)}
          >
            <SelectTrigger className="h-9 w-[160px] text-sm">
              <SelectValue placeholder="Captain" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All captains</SelectItem>
              {captainFacets.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={cityName}
            onValueChange={(v) => pushParam('city', v)}
          >
            <SelectTrigger className="h-9 w-[140px] text-sm">
              <SelectValue placeholder="City" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cities</SelectItem>
              {cityFacets.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={status}
            onValueChange={(v) => pushParam('status', v)}
          >
            <SelectTrigger className="h-9 w-[170px] text-sm">
              <SelectValue placeholder="Warning status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All warning states</SelectItem>
              <SelectItem value="none">No active warnings</SelectItem>
              <SelectItem value="has_soft">Has soft warnings</SelectItem>
              <SelectItem value="has_hard">Has hard warnings</SelectItem>
              <SelectItem value="fire">Eligible for termination</SelectItem>
            </SelectContent>
          </Select>

          {anyActive && (
            <button
              type="button"
              onClick={clearAll}
              disabled={pending}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Icon name="close" size="xs" />
              Clear
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
