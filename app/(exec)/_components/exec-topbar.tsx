"use client";

import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { resolveExecPageTitle } from "@/lib/exec-nav";

// =============================================================================
// HVA-115 / HVA-51: exec shell desktop top bar
// =============================================================================
//
// Desktop-only since HVA-51 (lg:flex). Mobile gets ExecMobileTopbar which
// hosts the hamburger drawer trigger + page title + avatar dropdown.
// Desktop here keeps the notification bell placeholder; identity + logout
// live in the persistent ExecSidebar footer.
// =============================================================================

interface ExecTopbarProps {
  fullName: string;
}

export function ExecTopbar({ fullName: _fullName }: ExecTopbarProps) {
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Notifications"
          className="h-10 w-10"
          title="Notifications (badge coming in HVA-48)"
        >
          <Icon name="notifications" size="sm" />
        </Button>
      </div>
    </header>
  );
}
