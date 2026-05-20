'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { ContactCard } from '@/components/contacts/ContactCard';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { buildListUrl } from '@/lib/pagination';
import { cn } from '@/lib/utils';

import { AddLeadFab } from './AddLeadFab';
import type {
  BusinessTypeOption,
  CityOption,
  LeadRow,
} from './types';

// =============================================================================
// HVA-73 + HVA-153: client-side filter + URL-driven search for /leads
// =============================================================================
//
// The page is now server-rendered against `?q`, `?type`, `?page`. This
// component owns the input + chip UI, debounces typing, and pushes
// updates back into the URL via router.push(). Any non-page filter
// change drops `?page` (handled by buildListUrl) so the list returns
// to page 1 on a new filter.
// =============================================================================

type TypeFilter = 'all' | 'Customer' | 'Business';

const FILTER_OPTIONS: ReadonlyArray<{ key: TypeFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'Customer', label: 'Customer' },
  { key: 'Business', label: 'Business' },
];

interface Props {
  rows: LeadRow[];
  cities: CityOption[];
  businessTypes: BusinessTypeOption[];
  /** Server-decoded query state — used to seed local controls. */
  initial: {
    q: string;
    type: TypeFilter;
  };
  /** Pre-filter type-bucket counts for the chip badges. */
  typeCounts: Record<TypeFilter, number>;
}

export function LeadsFilterClient({
  rows,
  cities,
  businessTypes,
  initial,
  typeCounts,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // The search input is the only control with debounce. Type chips push
  // immediately.
  const [searchText, setSearchText] = useState(initial.q);
  // Reseed local state when the URL changes externally (back/forward).
  // The `initial.q` prop only re-renders when the server re-fetches,
  // which happens on every router.push, so this keeps both views in
  // lockstep.
  const lastInitialQ = useRef(initial.q);
  if (lastInitialQ.current !== initial.q) {
    lastInitialQ.current = initial.q;
    if (searchText !== initial.q) setSearchText(initial.q);
  }

  // 300ms debounce on search input. Skip the initial render so we don't
  // re-push the URL on mount.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const id = setTimeout(() => {
      const trimmed = searchText.trim();
      if (trimmed === initial.q) return;
      startTransition(() => {
        router.push(
          buildListUrl(pathname, searchParams, { q: trimmed || null }),
        );
      });
    }, 300);
    return () => clearTimeout(id);
  }, [searchText, initial.q, pathname, router, searchParams]);

  function pushType(t: TypeFilter) {
    startTransition(() => {
      router.push(
        buildListUrl(pathname, searchParams, {
          type: t === 'all' ? null : t,
        }),
      );
    });
  }

  return (
    <div className="space-y-4">
      <Input
        type="search"
        inputMode="search"
        placeholder="Search by name, phone, city, or firm"
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        className="h-11"
        aria-label="Search contacts"
      />

      <nav
        aria-label="Filter by type"
        className="flex flex-wrap gap-1.5 border-b pb-3"
      >
        {FILTER_OPTIONS.map((opt) => {
          const active = initial.type === opt.key;
          return (
            <button
              type="button"
              key={opt.key}
              onClick={() => pushType(opt.key)}
              aria-current={active ? 'page' : undefined}
              disabled={isPending}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-muted-foreground/20 text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              <span>{opt.label}</span>
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px]',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted-foreground/15 text-muted-foreground',
                )}
              >
                {typeCounts[opt.key]}
              </span>
            </button>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center space-y-3">
          <Icon
            name="person_add"
            size="lg"
            className="text-muted-foreground/70 mx-auto"
          />
          <p className="text-sm text-muted-foreground">
            {initial.q
              ? `No leads matching "${initial.q}".`
              : initial.type !== 'all'
                ? `No ${initial.type.toLowerCase()} leads.`
                : 'No leads yet. Tap + to capture your first lead.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2" aria-label="Contacts">
          {rows.map((lead) => (
            <li key={lead.id}>
              <ContactCard
                id={lead.id}
                name={lead.name}
                type={lead.type}
                cityName={lead.cityName}
                capturedByName={lead.capturedByName}
                requestCount={lead.requestCount}
                converted={lead.convertedToRequestId !== null}
                hrefPrefix="/leads"
              />
            </li>
          ))}
        </ul>
      )}

      <AddLeadFab cities={cities} businessTypes={businessTypes} />

      {/* Spacer so the last card isn't hidden behind the bottom nav. */}
      <div className="h-24 lg:h-0" />
    </div>
  );
}
