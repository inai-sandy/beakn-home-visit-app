'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import type { DateFilter } from '@/lib/captain/dashboard-queries';

// =============================================================================
// HVA-80 extension: date filter picker (modal w/ Single / Range tabs)
// =============================================================================
//
// Implementation note: uses native `<input type="date">` rather than the
// shadcn Calendar primitive — shadcn Calendar requires `react-day-picker`
// as a dep, and the bundle forbids adding new component libraries. Native
// date input is already used in app/(exec)/today/_components/PostponeSheet.tsx
// (HVA-62) — well-supported on iOS Safari, Android Chrome, and desktop
// browsers, with `min`/`max` attrs enforcing the 30-day-back / today
// constraint at the input layer.
//
// On submit, updates the URL via router.push so the new filter is
// shareable + survives refresh. Server re-renders with the new
// searchParams.
// =============================================================================

function todayIstApprox(): string {
  // Browser-side approximation of getIstDateString() — adds +05:30 from
  // the user's UTC clock to get IST date string. Good enough for the
  // picker's defaults; the server is authoritative on actual filtering.
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const ist = new Date(utcMs + 5.5 * 60 * 60 * 1000);
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, '0');
  const d = String(ist.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function offsetDateLocal(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

interface Props {
  filter: DateFilter;
  /**
   * HVA-167: the route to push URL updates into. Required (no default)
   * so the captain drill-down doesn't silently navigate to the dashboard
   * if someone forgets to wire it. DashboardHeader passes
   * `/captain/dashboard`; ExecDrillDownHeader passes
   * `/captain/team/${execId}`.
   */
  pathname: string;
}

export function DateRangePicker({ filter, pathname }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // eslint-disable-next-line no-restricted-syntax -- HVA-149: URL push for date range, not a mutation
  const [isPending, startTransition] = useTransition();

  const today = useMemo(() => todayIstApprox(), []);
  const minDate = useMemo(() => offsetDateLocal(today, -30), [today]);
  const sevenDaysAgo = useMemo(() => offsetDateLocal(today, -6), [today]);

  // Tab state + per-tab local values seeded from the active filter.
  const [tab, setTab] = useState<'single' | 'range'>(
    filter.mode === 'range' ? 'range' : 'single',
  );
  const [singleDate, setSingleDate] = useState(
    filter.mode === 'single' ? filter.date : today,
  );
  const [rangeFrom, setRangeFrom] = useState(
    filter.mode === 'range' ? filter.from : sevenDaysAgo,
  );
  const [rangeTo, setRangeTo] = useState(
    filter.mode === 'range' ? filter.to : today,
  );

  function applyFilter() {
    const params = new URLSearchParams();
    if (tab === 'single') {
      // Skip the param entirely when picking today — keeps URLs clean for
      // the default view.
      if (singleDate !== today) params.set('date', singleDate);
    } else {
      params.set('from', rangeFrom);
      params.set('to', rangeTo);
    }
    const qs = params.toString();
    setOpen(false);
    startTransition(() => {
      router.push(qs === '' ? pathname : `${pathname}?${qs}`);
    });
  }

  function resetToToday() {
    setOpen(false);
    startTransition(() => {
      router.push(pathname);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="Pick date range"
        title="Pick date range"
        className="h-10 w-10 rounded-full focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon name="calendar_today" size="sm" />
      </Button>

      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pick a date</DialogTitle>
            <DialogDescription>
              Single day or a date range. Range limit: 30 days ago to today.
            </DialogDescription>
          </DialogHeader>

          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as 'single' | 'range')}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="single">Single day</TabsTrigger>
              <TabsTrigger value="range">Date range</TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="single-date" className="text-sm">
                  Date
                </Label>
                <Input
                  id="single-date"
                  type="date"
                  value={singleDate}
                  min={minDate}
                  max={today}
                  onChange={(e) => setSingleDate(e.target.value)}
                  className="h-11"
                />
              </div>
            </TabsContent>

            <TabsContent value="range" className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="range-from" className="text-sm">
                    From
                  </Label>
                  <Input
                    id="range-from"
                    type="date"
                    value={rangeFrom}
                    min={minDate}
                    max={rangeTo}
                    onChange={(e) => setRangeFrom(e.target.value)}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="range-to" className="text-sm">
                    To
                  </Label>
                  <Input
                    id="range-to"
                    type="date"
                    value={rangeTo}
                    min={rangeFrom}
                    max={today}
                    onChange={(e) => setRangeTo(e.target.value)}
                    className="h-11"
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="flex-row justify-between sm:justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetToToday}
              disabled={isPending}
            >
              Reset to Today
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={applyFilter}
                disabled={isPending}
              >
                Apply
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
