'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { buildListUrl } from '@/lib/pagination';

// =============================================================================
// HVA-153: URL-driven search + city + exec filters for /captain/requests
// =============================================================================
//
// Bucket tabs remain a separate component (RequestBucketTabs) — they're
// server-rendered links. This control owns the rest of the filter
// state: the search input, the city dropdown (when the captain owns
// multiple cities), and the exec dropdown (assigned-exec narrow).
//
// Same debounce-on-search semantics as the contacts pages. Type chips
// are absent here — requests aren't typed Customer/Business; the
// status_stages buckets play that role.
// =============================================================================

export interface CityOption {
  id: string;
  name: string;
}

export interface ExecOption {
  id: string;
  name: string;
}

interface Props {
  cityOptions: CityOption[];
  execOptions: ExecOption[];
  initial: {
    q: string;
    city: string;
    exec: string;
  };
}

export function RequestsFilterClient({
  cityOptions,
  execOptions,
  initial,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // eslint-disable-next-line no-restricted-syntax -- HVA-149: URL push, not a mutation
  const [isPending, startTransition] = useTransition();
  void isPending;

  const [searchText, setSearchText] = useState(initial.q);

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

  function pushCity(value: string) {
    startTransition(() => {
      router.push(
        buildListUrl(pathname, searchParams, {
          city: value === 'all' ? null : value,
        }),
      );
    });
  }

  function pushExec(value: string) {
    startTransition(() => {
      router.push(
        buildListUrl(pathname, searchParams, {
          exec: value === 'all' ? null : value,
        }),
      );
    });
  }

  const showCityDropdown = cityOptions.length > 1;
  const showExecDropdown = execOptions.length > 0;

  return (
    <div className="space-y-3">
      <Input
        type="search"
        inputMode="search"
        placeholder="Search by customer name, phone, or city"
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        className="h-11"
        aria-label="Search requests"
      />
      {(showCityDropdown || showExecDropdown) && (
        <div className="flex flex-wrap items-center gap-2">
          {showCityDropdown && (
            <Select value={initial.city} onValueChange={pushCity}>
              <SelectTrigger className="h-9 w-44 text-xs">
                <SelectValue placeholder="All cities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All cities</SelectItem>
                {cityOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {showExecDropdown && (
            <Select value={initial.exec} onValueChange={pushExec}>
              <SelectTrigger className="h-9 w-44 text-xs">
                <SelectValue placeholder="All execs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All execs</SelectItem>
                {execOptions.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  );
}
