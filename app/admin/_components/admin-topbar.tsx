"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { NotificationBell } from "@/components/notifications/NotificationBell";
import { resolveAdminPageTitle } from "@/lib/admin-nav";

import type { InAppNotificationRow } from "@/lib/notifications/in-app-queries";

// HVA-86 / HVA-87: admin shell top bar with real notification bell.

interface AdminTopbarProps {
  unreadInAppCount: number;
  initialNotifications: InAppNotificationRow[];
}

export function AdminTopbar({
  unreadInAppCount,
  initialNotifications,
}: AdminTopbarProps) {
  const pathname = usePathname() ?? "/admin";
  const searchParams = useSearchParams();
  const title = resolveAdminPageTitle(pathname, searchParams);

  return (
    // HVA-117: desktop topbar only renders at lg+. AdminMobileTopbar
    // takes over below lg (separate component with hamburger trigger).
    <header className="hidden lg:flex h-14 items-center justify-between gap-4 border-b bg-background px-6">
      <h1 className="text-lg font-semibold tracking-tight truncate min-w-0">
        {title}
      </h1>
      <div className="flex items-center gap-2 shrink-0">
        <NotificationBell
          unreadCount={unreadInAppCount}
          initialNotifications={initialNotifications}
        />
      </div>
    </header>
  );
}
