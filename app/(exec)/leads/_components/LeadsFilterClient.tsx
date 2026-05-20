'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { ContactCard } from '@/components/contacts/ContactCard';

import { AddLeadFab } from './AddLeadFab';
import type {
  BusinessTypeOption,
  CityOption,
  LeadRow,
} from './types';

// =============================================================================
// HVA-73: client-side filter + search for the /leads list
// =============================================================================
//
// Server hands the full row set + dropdown options down. This wrapper
// owns:
//   - 300ms debounced search by name / phone (digits-only normalisation
//     so "9885 698 665" matches "+919885698665")
//   - Filter chip row: All / Customer / Business
//   - The AddLeadFab + the per-card Plan-a-Visit conversion sheet trigger
//
// No URL state on the leads list (the surface is single-exec, not
// shareable like /captain/requests). All filter state stays in
// component memory.
// =============================================================================

type TypeFilter = 'all' | 'Customer' | 'Business';

const FILTER_OPTIONS: ReadonlyArray<{ key: TypeFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'Customer', label: 'Customer' },
  { key: 'Business', label: 'Business' },
];

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

function matchesSearch(row: LeadRow, q: string): boolean {
  const trimmed = q.trim();
  if (trimmed === '') return true;
  const needle = trimmed.toLowerCase();
  if (row.name.toLowerCase().includes(needle)) return true;
  if (row.cityName.toLowerCase().includes(needle)) return true;
  const needleDigits = digitsOnly(trimmed);
  if (needleDigits.length > 0 && digitsOnly(row.phone).includes(needleDigits)) {
    return true;
  }
  if (row.firmName && row.firmName.toLowerCase().includes(needle)) return true;
  return false;
}

interface Props {
  rows: LeadRow[];
  cities: CityOption[];
  businessTypes: BusinessTypeOption[];
}

export function LeadsFilterClient({ rows, cities, businessTypes }: Props) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<TypeFilter>('all');

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const counts = useMemo(() => {
    const c: Record<TypeFilter, number> = {
      all: rows.length,
      Customer: 0,
      Business: 0,
    };
    for (const r of rows) {
      if (r.type === 'Customer') c.Customer += 1;
      else if (r.type === 'Business') c.Business += 1;
    }
    return c;
  }, [rows]);

  const visible = useMemo(
    () =>
      rows.filter((r) => {
        if (filter !== 'all' && r.type !== filter) return false;
        return matchesSearch(r, debouncedSearch);
      }),
    [rows, filter, debouncedSearch],
  );

  return (
    <div className="space-y-4">
      <Input
        type="search"
        inputMode="search"
        placeholder="Search by name, phone, city, or firm"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-11"
        aria-label="Search leads"
      />

      <nav
        aria-label="Filter by type"
        className="flex flex-wrap gap-1.5 border-b pb-3"
      >
        {FILTER_OPTIONS.map((opt) => {
          const active = filter === opt.key;
          return (
            <button
              type="button"
              key={opt.key}
              onClick={() => setFilter(opt.key)}
              aria-current={active ? 'page' : undefined}
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
                {counts[opt.key]}
              </span>
            </button>
          );
        })}
      </nav>

      {visible.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center space-y-3">
          <Icon
            name="person_add"
            size="lg"
            className="text-muted-foreground/70 mx-auto"
          />
          <p className="text-sm text-muted-foreground">
            {debouncedSearch !== ''
              ? `No leads matching "${debouncedSearch}".`
              : filter === 'all'
                ? 'No leads yet. Tap + to capture your first lead.'
                : `No ${filter.toLowerCase()} leads.`}
          </p>
        </div>
      ) : (
        <ul className="space-y-2" aria-label="Contacts">
          {visible.map((lead) => (
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
