"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";

import { logoutAction } from "@/lib/auth/logout-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { CAPTAIN_NAV_ITEMS } from "@/lib/captain/nav";
import type { CaptainSidebarCounts } from "@/lib/captain/sidebar-counts";
import { cn } from "@/lib/utils";

// =============================================================================
// HVA-78: Captain app shell — left sidebar (240px fixed, no collapse)
// =============================================================================
//
// Client component because the active-link styling depends on usePathname.
// Server-rendered top block (captain name + city badges) is passed in as
// props from the (captain)/layout.tsx server component, so this file never
// hits the DB or auth.
//
// Spec: 240px fixed width, Compact density per M3, no responsive collapse
// (captain UI is laptop-only per UI/UX §Captain Laptop).
//
// Nav items are static links. All 8 routes resolve to a stub page in this
// issue (HVA-78 ships only the shell); HVA-80/83/etc. fill them in.
// =============================================================================

export interface SidebarCity {
  id: string;
  name: string;
}

interface SidebarProps {
  captainName: string;
  cities: SidebarCity[];
  /** HVA-156: unread-count badge next to the Announcements item. */
  unreadAnnouncementsCount?: number;
  /** HVA-129: badge counts for Requests / Pending Approvals / Finance. */
  sidebarCounts?: CaptainSidebarCounts;
}

// HVA-152: NAV_ITEMS extracted to lib/captain/nav.ts so the mobile drawer
// (CaptainSidebarSheet) renders from the same source. The local alias
// preserves the original variable name to keep the rest of this file's
// render output byte-identical.
const NAV_ITEMS = CAPTAIN_NAV_ITEMS;

export function CaptainSidebar({
  captainName,
  cities,
  unreadAnnouncementsCount = 0,
  sidebarCounts,
}: SidebarProps) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <aside
      className="w-60 shrink-0 h-svh sticky top-0 border-r bg-card flex flex-col"
      aria-label="Captain navigation"
    >
      {/* Top block: logo + name + city badges + bell stub */}
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
          {/* HVA-79 will fill in the bell badge count + SSE wiring. Stub icon
              today so the slot exists. Non-interactive on purpose. */}
          <button
            type="button"
            aria-label="Notifications (coming in HVA-79)"
            disabled
            className="ml-auto h-8 w-8 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60 disabled:opacity-60"
            data-stub="notification-bell"
          >
            <Icon name="notifications" size="sm" />
          </button>
        </div>
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Captain
          </p>
          <p className="text-sm font-semibold tracking-tight truncate">
            {captainName}
          </p>
        </div>
        {cities.length > 0 && (
          <div
            className="flex flex-wrap gap-1.5"
            aria-label="Assigned cities"
          >
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

      {/* Nav — Compact density (40dp height = h-10), primary tint when active */}
      <nav className="flex-1 overflow-y-auto p-2" aria-label="Sections">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            // Active when the URL is this item OR a descendant under it.
            // /captain/dashboard is exact-match only — sub-routes (none today)
            // would otherwise highlight Dashboard for unrelated pages.
            const isExact = pathname === item.href;
            const isUnder =
              item.href !== "/captain/dashboard" &&
              pathname.startsWith(`${item.href}/`);
            const active = isExact || isUnder;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "group flex items-center justify-between gap-3 h-10 px-3 rounded-md text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-foreground/80 hover:bg-muted/60 hover:text-foreground",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="inline-flex items-center gap-3 min-w-0">
                    <Icon
                      name={item.icon}
                      size="sm"
                      className={active ? "text-primary" : "text-muted-foreground"}
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.href === "/captain/announcements" &&
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
                  {/* HVA-129: action-queue badges. Same outline pill as the
                      announcements badge so the sidebar reads as one
                      consistent counter style. */}
                  {item.href === "/captain/requests" &&
                    (sidebarCounts?.newRequestsCount ?? 0) > 0 && (
                      <Badge
                        variant="outline"
                        className="text-[9px] tabular-nums border-primary/50 text-primary"
                        aria-label={`${sidebarCounts!.newRequestsCount} new requests`}
                      >
                        {sidebarCounts!.newRequestsCount > 99
                          ? "99+"
                          : sidebarCounts!.newRequestsCount}
                      </Badge>
                    )}
                  {item.href === "/captain/approvals" &&
                    (sidebarCounts?.pendingApprovalsCount ?? 0) > 0 && (
                      <Badge
                        variant="outline"
                        className="text-[9px] tabular-nums border-primary/50 text-primary"
                        aria-label={`${sidebarCounts!.pendingApprovalsCount} pending approvals`}
                      >
                        {sidebarCounts!.pendingApprovalsCount > 99
                          ? "99+"
                          : sidebarCounts!.pendingApprovalsCount}
                      </Badge>
                    )}
                  {item.href === "/captain/collections" &&
                    (sidebarCounts?.outstandingFinanceCount ?? 0) > 0 && (
                      <Badge
                        variant="outline"
                        className="text-[9px] tabular-nums border-primary/50 text-primary"
                        aria-label={`${sidebarCounts!.outstandingFinanceCount} outstanding finance items`}
                      >
                        {sidebarCounts!.outstandingFinanceCount > 99
                          ? "99+"
                          : sidebarCounts!.outstandingFinanceCount}
                      </Badge>
                    )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/*
        HVA-116 footer: Sign-out button. Mirrors the HVA-115 exec
        sidebar footer + HVA-86 admin user-footer pattern — same
        logoutAction (HVA-28 pipeline: Better-Auth signOut → session
        row delete → cookie clear → audit row → /login redirect).
      */}
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
