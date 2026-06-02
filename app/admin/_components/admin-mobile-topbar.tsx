"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { NotificationBell } from "@/components/notifications/NotificationBell";
import { resolveAdminPageTitle } from "@/lib/admin-nav";
import type { InAppNotificationRow } from "@/lib/notifications/in-app-queries";

import { AdminSidebarSheet } from "./admin-sidebar-sheet";

// =============================================================================
// HVA-117: Admin mobile topbar (lg:hidden)
// =============================================================================
//
// Sticky 56dp band that replaces the desktop-only AdminTopbar on
// viewports below the lg breakpoint. The hamburger control here opens
// the AdminSidebarSheet drawer; the page title is resolved from the
// current pathname via resolveAdminPageTitle (same source as the
// desktop topbar — keeps both surfaces in sync if a nav label is
// re-worded later).
// =============================================================================

interface Props {
  displayName: string;
  role: string;
  /** HVA-77 + HVA-94: pending admin help count drives the sidebar badge. */
  pendingHelpCount?: number;
  /** HVA-87: in-app notification bell. */
  unreadInAppCount?: number;
  initialNotifications?: InAppNotificationRow[];
}

export function AdminMobileTopbar({
  displayName,
  role,
  pendingHelpCount = 0,
  unreadInAppCount = 0,
  initialNotifications = [],
}: Props) {
  const pathname = usePathname() ?? "/admin/dashboard";
  const searchParams = useSearchParams();
  const title = resolveAdminPageTitle(pathname, searchParams);

  return (
    <header
      className="lg:hidden sticky top-0 z-20 h-14 flex items-center gap-2 border-b bg-background/95 backdrop-blur-sm px-4"
      aria-label="Page header"
    >
      <AdminSidebarSheet
        displayName={displayName}
        role={role}
        pendingHelpCount={pendingHelpCount}
      />
      <h1 className="flex-1 min-w-0 text-base font-medium tracking-tight truncate">
        {title}
      </h1>
      <NotificationBell
        unreadCount={unreadInAppCount}
        initialNotifications={initialNotifications}
        triggerClassName="h-11 w-11"
      />
    </header>
  );
}
