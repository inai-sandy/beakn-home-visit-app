'use client';

import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { resolveCaptainPageTitle } from '@/lib/captain/nav';
import type { CaptainSidebarCounts } from '@/lib/captain/sidebar-counts';

import { CaptainSidebarSheet } from './CaptainSidebarSheet';

// =============================================================================
// HVA-152: Captain mobile topbar (lg:hidden)
// =============================================================================
//
// Sticky 56dp band that replaces the existing desktop-only header on
// viewports below the lg breakpoint. The hamburger control here is the
// CaptainSidebarSheet trigger; the drawer body slides in over the page
// content with a backdrop.
//
// Page title is resolved from the current pathname via
// resolveCaptainPageTitle (lib/captain/nav.ts) — same source as the
// nav config, so any future re-label of a nav item updates both surfaces.
//
// Notification bell is a stub today (matches the desktop sidebar's
// HVA-79 placeholder). Disabled — no badge count, no click handler.
// =============================================================================

interface Props {
  captainName: string;
  cities: Array<{ id: string; name: string }>;
  /** HVA-156: unread-count badge next to the Announcements item. */
  unreadAnnouncementsCount?: number;
  /** HVA-129: badge counts for Requests / Pending Approvals / Finance. */
  sidebarCounts?: CaptainSidebarCounts;
}

export function CaptainMobileTopbar({
  captainName,
  cities,
  unreadAnnouncementsCount = 0,
  sidebarCounts,
}: Props) {
  const pathname = usePathname() ?? '/captain/dashboard';
  const title = resolveCaptainPageTitle(pathname);

  return (
    <header
      className="lg:hidden sticky top-0 z-20 h-14 flex items-center gap-2 border-b bg-background/95 backdrop-blur-sm px-4"
      aria-label="Page header"
    >
      <CaptainSidebarSheet
        captainName={captainName}
        cities={cities}
        unreadAnnouncementsCount={unreadAnnouncementsCount}
        sidebarCounts={sidebarCounts}
      />
      <h1 className="flex-1 min-w-0 text-base font-medium tracking-tight truncate">
        {title}
      </h1>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Notifications (coming in HVA-79)"
        disabled
        className="h-11 w-11 rounded-full text-muted-foreground/70 disabled:opacity-60"
      >
        <Icon name="notifications" size="sm" />
      </Button>
    </header>
  );
}
