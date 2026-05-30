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
import { cn } from '@/lib/utils';

import type { FinanceSection } from '@/lib/captain/finance-queries';

// =============================================================================
// PR12 2026-05-26: filters for /captain/collections
// =============================================================================
//
// Search + section toggle + exec dropdown + city dropdown. Every
// filter URL-encoded; debounced search; any non-page filter change
// resets ?page.
// =============================================================================

const SECTION_LABELS: Record<FinanceSection, string> = {
  all: 'All (Pipeline + Order Book)',
  order_book: 'Order Book',
  pipeline: 'Quotation Pipeline',
};

interface Props {
  team: Array<{ userId: string; fullName: string }>;
  cities: Array<{ id: string; name: string }>;
  currentSection: FinanceSection;
  currentExec: string;
  currentCity: string;
  currentSearch: string;
  /** PR13 2026-05-27: base path the URL pushes target. Defaults to
   *  '/captain/collections'; the exec finance page passes '/finance'. */
  basePath?: string;
}

export function FinanceFiltersBar({
  team,
  cities,
  currentSection,
  currentExec,
  currentCity,
  currentSearch,
  basePath = '/captain/collections',
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(currentSearch);
  // eslint-disable-next-line no-restricted-syntax -- HVA-149: URL push, not a mutation
  const [, startTransition] = useTransition();

  function push(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    let nonPage = false;
    for (const [k, v] of Object.entries(updates)) {
      if (k !== 'page') nonPage = true;
      if (v && v.length > 0 && v !== 'all') next.set(k, v);
      else next.delete(k);
    }
    if (nonPage) next.delete('page');
    const qs = next.toString();
    startTransition(() =>
      router.push(qs.length > 0 ? `${basePath}?${qs}` : basePath),
    );
  }

  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === currentSearch) return;
    const handle = setTimeout(() => {
      push({ q: trimmed.length > 0 ? trimmed : null });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, currentSearch]);

  // Section pills — bigger tap targets on mobile than a dropdown.
  const sections: FinanceSection[] = ['all', 'order_book', 'pipeline'];

  return (
    <section
      aria-label="Filters"
      className="space-y-3 rounded-3xl border bg-card p-4 shadow-sm"
    >
      <div className="flex flex-col lg:flex-row gap-2">
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
            placeholder="Search customer name or phone"
            className="h-11 pl-9"
            aria-label="Search finance"
          />
        </div>
        {team.length > 0 && (
          <Select
            value={currentExec}
            onValueChange={(v) => push({ exec: v === 'all' ? null : v })}
          >
            <SelectTrigger className="h-11 lg:w-52" aria-label="Filter by exec">
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
        )}
        {cities.length > 1 && (
          <Select
            value={currentCity}
            onValueChange={(v) => push({ city: v === 'all' ? null : v })}
          >
            <SelectTrigger className="h-11 lg:w-44" aria-label="Filter by city">
              <SelectValue placeholder="All cities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cities</SelectItem>
              {cities.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div
        className="flex flex-wrap gap-1.5"
        aria-label="Section"
      >
        {sections.map((s) => {
          const active = currentSection === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => push({ section: s })}
              className={cn(
                'inline-flex items-center rounded-full border px-3 py-1 text-[11px] tracking-wide transition-colors',
                active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card hover:bg-muted border-border text-foreground/80',
              )}
              aria-pressed={active}
            >
              {SECTION_LABELS[s]}
            </button>
          );
        })}
      </div>
    </section>
  );
}
