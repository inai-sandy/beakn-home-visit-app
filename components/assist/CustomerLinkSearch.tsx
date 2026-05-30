'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import type { LinkableVisitRequestOption } from '@/lib/assist/queries';
import { cn } from '@/lib/utils';

// HVA-199 follow-up: search-as-you-type combobox for linking an assist to
// an existing visit_request. Sandeep on prod 2026-05-30: a select dropdown
// doesn't scale once a team has hundreds of customers.
//
// Behavior:
//   - Empty state shows a search input.
//   - Typing fires a 300ms-debounced GET /api/assist/linkable-customers?q=...
//   - Results render as a list below the input; click selects + collapses.
//   - Selected state shows the picked customer with a Clear button.
//   - Optional — onChange(null) clears the link.

interface Props {
  value: LinkableVisitRequestOption | null;
  onChange: (value: LinkableVisitRequestOption | null) => void;
  initialSuggestions?: LinkableVisitRequestOption[];
}

interface ApiResponse {
  rows: LinkableVisitRequestOption[];
}

const DEBOUNCE_MS = 300;

export function CustomerLinkSearch({
  value,
  onChange,
  initialSuggestions = [],
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LinkableVisitRequestOption[]>(initialSuggestions);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // No fetch while the user has picked something; only resume on clear.
    if (value !== null) return;
    if (!open) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const url = `/api/assist/linkable-customers?q=${encodeURIComponent(query.trim())}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as ApiResponse;
        if (controller.signal.aborted) return;
        setResults(data.rows ?? []);
      } catch {
        // AbortError + network errors swallowed; next keystroke retries.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [query, open, value]);

  if (value !== null) {
    return (
      <div className="rounded-md border bg-background px-3 py-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{value.customerName}</p>
          <p className="text-xs text-muted-foreground truncate">
            {value.cityName} · {value.stageName}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange(null);
            setQuery('');
            setResults(initialSuggestions);
            setOpen(false);
          }}
          aria-label="Clear customer link"
          className="h-8 px-2 text-xs"
        >
          <Icon name="close" size="xs" />
          Clear
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
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
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Type to search your customers"
          className="h-11 pl-9"
          aria-label="Search customers"
        />
      </div>
      {open && (
        <div className="rounded-md border bg-background shadow-sm overflow-hidden">
          {loading && results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {query.trim().length === 0
                ? 'Start typing to search customers'
                : 'No matching customers'}
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto divide-y">
              {results.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(row);
                      setOpen(false);
                      setQuery('');
                    }}
                    className={cn(
                      'w-full text-left px-3 py-2 hover:bg-accent/40 transition-colors',
                    )}
                  >
                    <p className="text-sm font-medium truncate">{row.customerName}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {row.cityName} · {row.stageName}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
