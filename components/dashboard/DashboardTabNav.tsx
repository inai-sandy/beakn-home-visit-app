"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { cn } from "@/lib/utils";

// =============================================================================
// HVA-290: DashboardTabNav — URL-driven dashboard tab switcher
// =============================================================================
//
// The dashboards split into tabs (exec/captain: Today | Overall; admin:
// Today | This month | Overall). Each tab is a distinct server render —
// clicking a tab pushes `?view=<value>` (preserving any date params) and
// the page renders only that tab's content, so a heavy tab's queries
// don't run while you're on a light one.
//
// `?view` is the single source of which tab is active; the page reads it
// and passes `active` back in. No client state to drift.
// =============================================================================

export interface DashboardTab {
  value: string;
  label: string;
}

interface Props {
  tabs: DashboardTab[];
  active: string;
  /** Date params to preserve when switching tabs (e.g. from/to). */
  preserveParams?: string[];
}

export function DashboardTabNav({ tabs, active, preserveParams = [] }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // eslint-disable-next-line no-restricted-syntax -- HVA-290: URL push for tab switch, not a mutation
  const [isPending, startTransition] = useTransition();

  function select(value: string) {
    if (value === active) return;
    const params = new URLSearchParams();
    for (const key of preserveParams) {
      const v = searchParams.get(key);
      if (v) params.set(key, v);
    }
    params.set("view", value);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div
      role="tablist"
      aria-label="Dashboard view"
      className={cn(
        "inline-flex items-center gap-1 rounded-full border bg-muted/40 p-1",
        isPending && "opacity-70",
      )}
    >
      {tabs.map((tab) => {
        const selected = tab.value === active;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => select(tab.value)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
