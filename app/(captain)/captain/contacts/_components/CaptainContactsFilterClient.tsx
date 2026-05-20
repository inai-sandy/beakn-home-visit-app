'use client';

import { useEffect, useMemo, useState } from 'react';

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
import type {
  TeamContactRow,
  TeamExecOption,
} from '@/lib/captain/contacts-queries';

import { ContactCard } from '@/components/contacts/ContactCard';

// =============================================================================
// HVA-73 PR 2: captain contacts list — search + type filter + exec filter
// =============================================================================
//
// Mirrors the exec /leads client wrapper but adds an exec dropdown chip
// since a captain views many execs' contacts in one list.
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

function matchesSearch(row: TeamContactRow, q: string): boolean {
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
  if (
    row.capturedByName &&
    row.capturedByName.toLowerCase().includes(needle)
  ) {
    return true;
  }
  return false;
}

interface Props {
  rows: TeamContactRow[];
  execOptions: TeamExecOption[];
}

export function CaptainContactsFilterClient({ rows, execOptions }: Props) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [execFilter, setExecFilter] = useState<string>('all');

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
        if (typeFilter !== 'all' && r.type !== typeFilter) return false;
        if (execFilter !== 'all' && r.capturedByUserId !== execFilter) return false;
        return matchesSearch(r, debouncedSearch);
      }),
    [rows, typeFilter, execFilter, debouncedSearch],
  );

  return (
    <div className="space-y-4">
      <Input
        type="search"
        inputMode="search"
        placeholder="Search by name, phone, city, firm, or captor"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-11"
        aria-label="Search contacts"
      />

      <div className="flex flex-wrap items-center gap-2">
        <nav
          aria-label="Filter by type"
          className="flex flex-wrap gap-1.5"
        >
          {FILTER_OPTIONS.map((opt) => {
            const active = typeFilter === opt.key;
            return (
              <button
                type="button"
                key={opt.key}
                onClick={() => setTypeFilter(opt.key)}
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

        <div className="ml-auto">
          <Select value={execFilter} onValueChange={setExecFilter}>
            <SelectTrigger className="h-9 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All execs</SelectItem>
              {execOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center space-y-3">
          <Icon
            name="contacts"
            size="lg"
            className="text-muted-foreground/70 mx-auto"
          />
          <p className="text-sm text-muted-foreground">
            {debouncedSearch !== ''
              ? `No contacts matching "${debouncedSearch}".`
              : execFilter !== 'all'
                ? 'No contacts for this exec.'
                : rows.length === 0
                  ? 'No contacts captured by your team yet.'
                  : `No ${typeFilter.toLowerCase()} contacts.`}
          </p>
        </div>
      ) : (
        <ul className="space-y-2" aria-label="Contacts">
          {visible.map((c) => (
            <li key={c.id}>
              <ContactCard
                id={c.id}
                name={c.name}
                type={c.type}
                cityName={c.cityName}
                capturedByName={c.capturedByName}
                requestCount={c.requestCount}
                converted={c.convertedToRequestId !== null}
                hrefPrefix="/captain/contacts"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
