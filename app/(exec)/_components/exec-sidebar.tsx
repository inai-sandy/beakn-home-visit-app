"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";

import { logoutAction } from "@/lib/auth/logout-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { EXEC_DRAWER_NAV, isExecNavItemActive } from "@/lib/exec-nav";
import { cn } from "@/lib/utils";

// =============================================================================
// HVA-115: exec shell desktop sidebar (≥ lg breakpoint, 240px fixed width)
// =============================================================================
//
// Mirrors the HVA-78 captain sidebar shape: logo + identity block at the
// top, nav list in the middle, user footer at the bottom. Hidden on
// mobile/tablet via `hidden lg:flex` — the bottom nav handles those
// viewports.
//
// Identity block shows three pieces of context (all server-fetched in
// the layout):
//   * Exec name (session.user.name)
//   * Captain name (joined through sales_executives.captain_user_id)
//   * Cities served (captain's cities — execs serve all of captain's cities)
//
// captainName + cities arrive as props; the layout does the SQL.
// =============================================================================

export interface SidebarCity {
  id: string;
  name: string;
}

interface ExecSidebarProps {
  fullName: string;
  captainName: string | null;
  cities: SidebarCity[];
  /** HVA-156: unread-count badge next to the Announcements item. */
  unreadAnnouncementsCount?: number;
}

export function ExecSidebar({
  fullName,
  captainName,
  cities,
  unreadAnnouncementsCount = 0,
}: ExecSidebarProps) {
  const pathname = usePathname() ?? "/today";
  const [pending, startTransition] = useTransition();

  return (
    <aside
      className="hidden lg:flex w-60 shrink-0 h-svh sticky top-0 border-r bg-card flex-col"
      aria-label="Executive navigation"
    >
      {/* Top: logo + identity */}
      <div className="p-4 space-y-3 border-b">
        <div className="flex items-center gap-3">
          <Image
            src="/icon-512x512.png"
            alt="Beakn"
            width={32}
            height={32}
            priority
            className="rounded-md shrink-0"
          />
          <span className="text-sm font-semibold tracking-tight">
            Beakn
          </span>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Executive
          </p>
          <p className="text-sm font-semibold tracking-tight truncate">
            {fullName}
          </p>
        </div>
        {captainName && (
          <p className="text-xs text-muted-foreground">
            Reports to{" "}
            <span className="text-foreground/80">{captainName}</span>
          </p>
        )}
        {cities.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Cities served">
            {cities.map((c) => (
              <Badge
                key={c.id}
                variant="secondary"
                className="text-[10px] uppercase tracking-wide px-2 py-0.5"
              >
                {c.name}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Nav — HVA-170-FIX3: reads EXEC_DRAWER_NAV so the desktop sidebar
          surfaces Tasks / Resources / Announcements alongside the
          bottom-nav set. Bottom-nav stays bounded at 5 items via EXEC_NAV
          (mobile screen width). */}
      <nav className="flex-1 overflow-y-auto p-2" aria-label="Sections">
        <ul className="space-y-0.5">
          {EXEC_DRAWER_NAV.map((item) => {
            const active = isExecNavItemActive(item, pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center justify-between gap-3 h-10 px-3 rounded-md text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-foreground/80 hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span className="inline-flex items-center gap-3 min-w-0">
                    <Icon
                      name={item.icon}
                      size="sm"
                      fill={active}
                      className={
                        active ? "text-primary" : "text-muted-foreground"
                      }
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.isStub && (
                    <Badge
                      variant="outline"
                      className="text-[9px] uppercase tracking-wide"
                    >
                      Soon
                    </Badge>
                  )}
                  {item.href === "/announcements" &&
                    unreadAnnouncementsCount > 0 && (
                      <Badge
                        variant="outline"
                        className="text-[9px] tabular-nums border-primary/50 text-primary"
                        aria-label={`${unreadAnnouncementsCount} unread announcements`}
                      >
                        {unreadAnnouncementsCount > 99
                          ? "99+"
                          : unreadAnnouncementsCount}
                      </Badge>
                    )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer: logout */}
      <div className="border-t p-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-start h-9"
          disabled={pending}
          onClick={() => startTransition(() => logoutAction())}
        >
          <Icon name="logout" size="xs" />
          <span>{pending ? "Signing out…" : "Sign out"}</span>
        </Button>
      </div>
    </aside>
  );
}
