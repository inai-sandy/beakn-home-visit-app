'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { ContactCard } from '@/components/contacts/ContactCard';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { buildListUrl } from '@/lib/pagination';
import { cn } from '@/lib/utils';
import type {
  TeamContactRow,
  TeamExecOption,
} from '@/lib/captain/contacts-queries';

// =============================================================================
// HVA-73 + HVA-153: URL-driven search + filter UI for /captain/contacts
// =============================================================================

type TypeFilter = 'all' | 'Customer' | 'Business';

const FILTER_OPTIONS: ReadonlyArray<{ key: TypeFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'Customer', label: 'Customer' },
  { key: 'Business', label: 'Business' },
];

interface Props {
  rows: TeamContactRow[];
  execOptions: TeamExecOption[];
  initial: {
    q: string;
    type: TypeFilter;
    exec: string;
  };
  typeCounts: Record<TypeFilter, number>;
}

export function CaptainContactsFilterClient({
  rows,
  execOptions,
  initial,
  typeCounts,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // eslint-disable-next-line no-restricted-syntax -- HVA-149: URL push, not a mutation
  const [isPending, startTransition] = useTransition();

  const [searchText, setSearchText] = useState(initial.q);

  // Reseed local state when the URL changes (back/forward).
  const lastInitialQ = useRef(initial.q);
  if (lastInitialQ.current !== initial.q) {
    lastInitialQ.current = initial.q;
    if (searchText !== initial.q) setSearchText(initial.q);
  }

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

  function pushExec(execId: string) {
    startTransition(() => {
      router.push(
        buildListUrl(pathname, searchParams, {
          exec: execId === 'all' ? null : execId,
        }),
      );
    });
  }

  return (
    <div className="space-y-4">
      <Input
        type="search"
        inputMode="search"
        placeholder="Search by name, phone, city, firm, or captor"
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        className="h-11"
        aria-label="Search contacts"
      />

      <div className="flex flex-wrap items-center gap-2">
        <nav
          aria-label="Filter by type"
          className="flex flex-wrap gap-1.5"
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

        <div className="ml-auto">
          <Select value={initial.exec} onValueChange={pushExec}>
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

      {rows.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center space-y-3">
          <Icon
            name="contacts"
            size="lg"
            className="text-muted-foreground/70 mx-auto"
          />
          <p className="text-sm text-muted-foreground">
            {initial.q !== ''
              ? `No contacts matching "${initial.q}".`
              : initial.exec !== 'all'
                ? 'No contacts for this exec.'
                : initial.type !== 'all'
                  ? `No ${initial.type.toLowerCase()} contacts.`
                  : 'No contacts captured by your team yet.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2" aria-label="Contacts">
          {rows.map((c) => (
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
