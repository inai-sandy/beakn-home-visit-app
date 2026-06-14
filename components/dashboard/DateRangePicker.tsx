"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { DateFilter } from "@/lib/captain/dashboard-queries";

// =============================================================================
// HVA-290: shared dashboard DateRangePicker
// =============================================================================
//
// Generalised from the captain dashboard's picker (HVA-80/277). Native
// <input type="date"> (no new dep), Single / Range tabs, pushes the choice
// into the URL so it's shareable + survives refresh. `extraParams` lets a
// caller keep other URL state intact when applying a date — the redesigned
// dashboards pass `{ view: 'overall' }` so picking a range doesn't knock
// you back to the Today tab.
// =============================================================================

function todayIstApprox(): string {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const ist = new Date(utcMs + 5.5 * 60 * 60 * 1000);
  const y = ist.getFullYear();
  const m = String(ist.getMonth() + 1).padStart(2, "0");
  const d = String(ist.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function offsetDateLocal(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

interface Props {
  filter: DateFilter;
  /** Route to push URL updates into (no default — caller must wire it). */
  pathname: string;
  /** How far back the calendar allows. Default 365. */
  maxDaysBack?: number;
  /** Extra URL params merged into every push (e.g. { view: 'overall' }). */
  extraParams?: Record<string, string>;
  /** Optional trigger label; defaults to an icon-only calendar button. */
  triggerLabel?: string;
}

export function DateRangePicker({
  filter,
  pathname,
  maxDaysBack = 365,
  extraParams = {},
  triggerLabel,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // eslint-disable-next-line no-restricted-syntax -- HVA-290: URL push for date range, not a mutation
  const [isPending, startTransition] = useTransition();

  const today = useMemo(() => todayIstApprox(), []);
  const minDate = useMemo(
    () => offsetDateLocal(today, -maxDaysBack),
    [today, maxDaysBack],
  );
  const sevenDaysAgo = useMemo(() => offsetDateLocal(today, -6), [today]);

  const [tab, setTab] = useState<"single" | "range">(
    filter.mode === "range" ? "range" : "single",
  );
  const [singleDate, setSingleDate] = useState(
    filter.mode === "single" ? filter.date : today,
  );
  const [rangeFrom, setRangeFrom] = useState(
    filter.mode === "range" ? filter.from : sevenDaysAgo,
  );
  const [rangeTo, setRangeTo] = useState(
    filter.mode === "range" ? filter.to : today,
  );

  function pushWith(params: URLSearchParams) {
    for (const [k, v] of Object.entries(extraParams)) params.set(k, v);
    const qs = params.toString();
    setOpen(false);
    startTransition(() => {
      router.push(qs === "" ? pathname : `${pathname}?${qs}`);
    });
  }

  function applyFilter() {
    const params = new URLSearchParams();
    if (tab === "single") {
      params.set("date", singleDate);
    } else {
      params.set("from", rangeFrom);
      params.set("to", rangeTo);
    }
    pushWith(params);
  }

  function resetToToday() {
    pushWith(new URLSearchParams());
  }

  return (
    <>
      {triggerLabel ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="rounded-full"
        >
          <Icon name="calendar_today" size="xs" />
          {triggerLabel}
        </Button>
      ) : (
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
      )}

      <Dialog open={open} onOpenChange={(o) => !isPending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pick a date</DialogTitle>
            <DialogDescription>
              Single day or a date range. Limit:{" "}
              {maxDaysBack >= 365 ? "one year" : `${maxDaysBack} days`} back to
              today.
            </DialogDescription>
          </DialogHeader>

          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "single" | "range")}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="single">Single day</TabsTrigger>
              <TabsTrigger value="range">Date range</TabsTrigger>
            </TabsList>

            <TabsContent value="single" className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="drp-single" className="text-sm">
                  Date
                </Label>
                <Input
                  id="drp-single"
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
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="drp-from" className="text-sm">
                    From
                  </Label>
                  <Input
                    id="drp-from"
                    type="date"
                    value={rangeFrom}
                    min={minDate}
                    max={rangeTo}
                    onChange={(e) => setRangeFrom(e.target.value)}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="drp-to" className="text-sm">
                    To
                  </Label>
                  <Input
                    id="drp-to"
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

          <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetToToday}
              disabled={isPending}
            >
              Reset
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
