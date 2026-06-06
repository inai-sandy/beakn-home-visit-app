'use client';

import { usePathname } from 'next/navigation';

import { activeSupportNav } from '@/lib/support/nav';

// =============================================================================
// HVA-235: SupportTopbar — top bar for /support/*
// =============================================================================
//
// 56dp top strip with the current page title. Bell + actions land in
// Phase 2. Mobile drawer trigger also lands in Phase 2 alongside
// SupportSidebarSheet.
// =============================================================================

export function SupportTopbar() {
  const pathname = usePathname();
  const item = activeSupportNav(pathname);
  const title = item?.label ?? 'Support portal';

  return (
    <header
      role="banner"
      aria-label="Page header"
      className="h-14 border-b bg-background/95 backdrop-blur sticky top-0 z-30 flex items-center px-4"
    >
      <h1 className="text-base font-semibold tracking-tight">{title}</h1>
    </header>
  );
}
