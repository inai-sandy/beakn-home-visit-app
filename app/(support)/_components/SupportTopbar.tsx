'use client';

import { usePathname } from 'next/navigation';

import { NotificationBell } from '@/components/notifications/NotificationBell';
import type { InAppNotificationRow } from '@/lib/notifications/in-app-queries';
import { activeSupportNav, type SupportNavCounts } from '@/lib/support/nav';

import { SupportSidebarSheet } from './SupportSidebarSheet';

// =============================================================================
// HVA-235: SupportTopbar — top bar for /support/*
// =============================================================================
//
// 56dp top strip with: mobile hamburger (opens SupportSidebarSheet below
// lg), the current page title, and the shared in-app NotificationBell.
//
// HVA-231 Phase 2: mobile drawer + bell landed here, bringing Support to
// parity with the captain / exec / admin shells. The bell reuses the
// role-agnostic component from HVA-52; support users receive in-app
// notifications via the support_team_all recipient rules.
// =============================================================================

interface Props {
  fullName: string;
  navCounts?: SupportNavCounts;
  /** HVA-52: drives the bell badge + drawer feed. */
  unreadInAppCount?: number;
  initialNotifications?: InAppNotificationRow[];
}

export function SupportTopbar({
  fullName,
  navCounts,
  unreadInAppCount = 0,
  initialNotifications = [],
}: Props) {
  const pathname = usePathname();
  const item = activeSupportNav(pathname);
  const title = item?.label ?? 'Support portal';

  return (
    <header
      role="banner"
      aria-label="Page header"
      className="h-14 border-b bg-background/95 backdrop-blur sticky top-0 z-30 flex items-center gap-2 px-4"
    >
      <SupportSidebarSheet fullName={fullName} navCounts={navCounts} />
      <h1 className="flex-1 min-w-0 text-base font-semibold tracking-tight truncate">
        {title}
      </h1>
      <NotificationBell
        unreadCount={unreadInAppCount}
        initialNotifications={initialNotifications}
      />
    </header>
  );
}
