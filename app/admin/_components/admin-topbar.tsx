"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { resolveAdminPageTitle } from "@/lib/admin-nav";

// =============================================================================
// HVA-86: admin shell top bar
// =============================================================================
//
// 56px-tall band above the content. Left half shows the page title
// (derived from pathname via the same admin-nav helper that drives
// active state). Right half holds the notification bell — visual only
// for this ship. Badge logic is HVA-79's scope.
// =============================================================================

export function AdminTopbar() {
  const pathname = usePathname() ?? "/admin";
  const searchParams = useSearchParams();
  const title = resolveAdminPageTitle(pathname, searchParams);

  return (
    <header className="h-14 flex items-center justify-between gap-4 border-b bg-background px-6">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Notifications"
          className="h-10 w-10 relative"
          title="Notifications (badge coming in HVA-79)"
        >
          <Icon name="notifications" size="sm" />
        </Button>
      </div>
    </header>
  );
}
