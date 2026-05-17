"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { resolveExecPageTitle } from "@/lib/exec-nav";

import { ExecAvatarMenu } from "./exec-avatar-menu";

// =============================================================================
// HVA-115: exec shell top bar
// =============================================================================
//
// Sticky band above the content area. 56dp tall on mobile/tablet —
// matches M3 top-app-bar small density. On desktop the same component
// renders; only the avatar slot is suppressed in favor of the sidebar
// footer's Sign-out button.
//
// Layout:
//   * mobile/tablet: logo + page title + avatar dropdown
//   * desktop (≥ lg): page title + notification bell placeholder (HVA-48)
//
// Logo is rendered only on < lg so the desktop sidebar's logo isn't
// duplicated.
// =============================================================================

interface ExecTopbarProps {
  fullName: string;
}

export function ExecTopbar({ fullName }: ExecTopbarProps) {
  const pathname = usePathname() ?? "/today";
  const title = resolveExecPageTitle(pathname);

  return (
    <header className="sticky top-0 z-20 h-14 flex items-center justify-between gap-3 border-b bg-background/95 backdrop-blur-sm px-4 lg:px-6">
      <div className="flex items-center gap-3 min-w-0">
        {/* Logo — mobile/tablet only; sidebar carries it on desktop. */}
        <Image
          src="/icon-512x512.png"
          alt="Beakn"
          width={32}
          height={32}
          priority
          className="rounded-md shrink-0 lg:hidden"
        />
        <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-1">
        {/* Notification bell — desktop slot. Mobile keeps the avatar
            in the right slot per M3 mobile top-app-bar. */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Notifications"
          className="hidden lg:inline-flex h-10 w-10"
          title="Notifications (badge coming in HVA-48)"
        >
          <Icon name="notifications" size="sm" />
        </Button>

        {/* Avatar dropdown — mobile/tablet only; desktop sidebar
            footer carries Profile + Logout instead. */}
        <div className="lg:hidden">
          <ExecAvatarMenu fullName={fullName} />
        </div>
      </div>
    </header>
  );
}
