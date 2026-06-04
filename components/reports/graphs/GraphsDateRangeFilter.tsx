'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// =============================================================================
// GraphsDateRangeFilter — URL-driven from/to picker for graphs pages
// =============================================================================
//
// Two <input type="date"> + an Apply button. Quick presets jump to
// canonical windows (last 7 / 30 / 90 days) so the most common cases
// are one tap. Submits push `?from=YYYY-MM-DD&to=YYYY-MM-DD` to the
// URL — page is a server component that reads searchParams and reruns
// the bundle loader.
//
// Validation: server-side `isValidIstDate` rejects malformed values
// and falls back to the 30-day default. We additionally clamp
// `from <= to` client-side before submit.
// =============================================================================

interface Props {
  fromDate: string;
  toDate: string;
  /** Today's IST date — used to anchor the "Last N days" presets so the
   *  client doesn't accidentally drift past midnight IST. Optional; if
   *  omitted, we fall back to `new Date()`. */
  istToday?: string;
}

function shiftDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function GraphsDateRangeFilter({
  fromDate,
  toDate,
  istToday,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [from, setFrom] = useState(fromDate);
  const [to, setTo] = useState(toDate);

  const anchor = useMemo(() => {
    if (istToday) return istToday;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, [istToday]);

  function push(nextFrom: string, nextTo: string) {
    const next = new URLSearchParams(params?.toString() ?? '');
    next.set('from', nextFrom);
    next.set('to', nextTo);
    const qs = next.toString();
    startTransition(() => {
      router.push(`?${qs}`);
    });
  }

  function applyManual() {
    if (!from || !to) return;
    const lo = from <= to ? from : to;
    const hi = from <= to ? to : from;
    setFrom(lo);
    setTo(hi);
    push(lo, hi);
  }

  function preset(days: number) {
    const hi = anchor;
    const lo = shiftDays(anchor, -(days - 1));
    setFrom(lo);
    setTo(hi);
    push(lo, hi);
  }

  const isCustom =
    fromDate !== shiftDays(anchor, -29) ||
    toDate !== anchor;

  return (
    <section
      aria-label="Window"
      className="rounded-2xl border bg-card p-3 sm:p-4 flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label
            htmlFor="graphs-from"
            className="text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            From
          </Label>
          <Input
            id="graphs-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 text-sm w-[150px]"
            aria-label="From date"
          />
        </div>
        <div className="space-y-1">
          <Label
            htmlFor="graphs-to"
            className="text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            To
          </Label>
          <Input
            id="graphs-to"
            type="date"
            value={to}
            min={from}
            max={anchor}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 text-sm w-[150px]"
            aria-label="To date"
          />
        </div>
        <Button
          size="sm"
          onClick={applyManual}
          disabled={pending}
          className="h-9"
        >
          <Icon name="check" size="xs" />
          {pending ? 'Applying…' : 'Apply'}
        </Button>

        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">
            Quick
          </span>
          {[
            { label: '7d', days: 7 },
            { label: '30d', days: 30 },
            { label: '90d', days: 90 },
          ].map((p) => {
            const presetFrom = shiftDays(anchor, -(p.days - 1));
            const active = fromDate === presetFrom && toDate === anchor;
            return (
              <button
                key={p.days}
                type="button"
                onClick={() => preset(p.days)}
                disabled={pending}
                aria-pressed={active}
                className={`text-[11px] font-medium rounded-md px-2.5 py-1 border transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-muted-foreground border-border hover:bg-accent hover:text-foreground'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {isCustom && fromDate !== '' && toDate !== '' && (
        <p className="text-[11px] text-muted-foreground">
          Custom window: {fromDate} → {toDate} (
          {Math.floor(
            (Date.UTC(
              Number(toDate.slice(0, 4)),
              Number(toDate.slice(5, 7)) - 1,
              Number(toDate.slice(8, 10)),
            ) -
              Date.UTC(
                Number(fromDate.slice(0, 4)),
                Number(fromDate.slice(5, 7)) - 1,
                Number(fromDate.slice(8, 10)),
              )) /
              86_400_000,
          ) + 1}{' '}
          day
          {fromDate === toDate ? '' : 's'})
        </p>
      )}
    </section>
  );
}
