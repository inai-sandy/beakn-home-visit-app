"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon } from "@/components/ui/icon";
import { EXEC_NAV, isExecNavItemActive } from "@/lib/exec-nav";
import { cn } from "@/lib/utils";

// =============================================================================
// HVA-115: mobile/tablet bottom navigation bar
// =============================================================================
//
// Sticky at the bottom of the viewport on screens < 1024px. 80dp tall —
// M3 Navigation Bar spec — with the exec destinations stacked
// icon-over-label. Column count tracks EXEC_NAV.length so adding/removing
// a destination doesn't break the equal-width layout.
//
// Active state: filled-variant icon + primary text color. Inactive:
// outlined icon + muted color.
//
// Safe-area padding: `pb-[env(safe-area-inset-bottom)]` so the bar sits
// above the iOS home indicator on PWA installs / standalone Safari.
// =============================================================================

export function ExecBottomNav() {
  const pathname = usePathname() ?? "/today";
  return (
    <nav
      aria-label="Primary"
      className={cn(
        "lg:hidden",
        "sticky bottom-0 z-30 w-full",
        "border-t bg-card",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${EXEC_NAV.length}, minmax(0, 1fr))`,
        }}
      >
        {EXEC_NAV.map((item) => {
          const active = isExecNavItemActive(item, pathname);
          return (
            <li key={item.href} className="flex min-w-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // HVA-266: min-w-0 lets each item shrink to its grid
                  // track. Without it, flexbox's min-width:auto kept the
                  // widest label ("Dashboard" ≈ 75px incl. padding) from
                  // compressing, blowing the 5-track grid out by ~8px on
                  // 320px phones — which put EVERY exec page into
                  // horizontal scroll.
                  "flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 h-16 px-1",
                  "transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "inline-flex items-center justify-center rounded-full px-3 py-0.5 transition-colors",
                    active && "bg-primary/15",
                  )}
                >
                  <Icon name={item.icon} size="sm" fill={active} />
                </span>
                <span
                  className={cn(
                    "text-[11px] leading-none max-w-full truncate",
                    active ? "font-semibold" : "font-medium",
                  )}
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
