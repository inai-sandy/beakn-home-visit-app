"use client";

import { usePathname } from "next/navigation";

import { NotificationBell } from "@/components/notifications/NotificationBell";
import { resolveExecPageTitle } from "@/lib/exec-nav";

import type { InAppNotificationRow } from "@/lib/notifications/in-app-queries";

// HVA-115 / HVA-51: exec shell desktop top bar.
// HVA-52: real notification bell replaces the HVA-48 placeholder.
//
// Desktop-only since HVA-51 (lg:flex). Identity + logout live in the
// persistent ExecSidebar footer.

interface ExecTopbarProps {
  fullName: string;
  unreadInAppCount: number;
  initialNotifications: InAppNotificationRow[];
}

export function ExecTopbar({
  fullName: _fullName,
  unreadInAppCount,
  initialNotifications,
}: ExecTopbarProps) {
  const pathname = usePathname() ?? "/today";
  const title = resolveExecPageTitle(pathname);

  return (
    <header className="hidden lg:flex sticky top-0 z-20 h-14 items-center justify-between gap-3 border-b bg-background/95 backdrop-blur-sm px-4 lg:px-6">
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-1">
        <NotificationBell
          unreadCount={unreadInAppCount}
          initialNotifications={initialNotifications}
        />
      </div>
    </header>
  );
}
