'use client';

import { usePathname } from 'next/navigation';

import { resolveExecPageTitle } from '@/lib/exec-nav';

import { ExecAvatarMenu } from './exec-avatar-menu';
import { ExecSidebarSheet } from './ExecSidebarSheet';

// =============================================================================
// HVA-51: Sales exec mobile topbar (lg:hidden)
// =============================================================================
//
// Mirrors the HVA-152 captain mobile topbar shape. Three slots:
//   - Left:   hamburger (drawer trigger lives inside ExecSidebarSheet)
//   - Center: page title (resolveExecPageTitle from lib/exec-nav.ts)
//   - Right:  avatar dropdown (Profile + Logout)
//
// Rendered only below the lg breakpoint; the legacy ExecTopbar handles
// desktop. The mobile avatar dropdown that used to live on the legacy
// topbar moved here in HVA-51 so there's exactly one mobile header.
// =============================================================================

interface Props {
  fullName: string;
  captainName: string | null;
  cities: Array<{ id: string; name: string }>;
}

export function ExecMobileTopbar({ fullName, captainName, cities }: Props) {
  const pathname = usePathname() ?? '/today';
  const title = resolveExecPageTitle(pathname);

  return (
    <header
      className="lg:hidden sticky top-0 z-20 h-14 flex items-center gap-2 border-b bg-background/95 backdrop-blur-sm px-4"
      aria-label="Page header"
    >
      <ExecSidebarSheet
        fullName={fullName}
        captainName={captainName}
        cities={cities}
      />
      <h1 className="flex-1 min-w-0 text-base font-medium tracking-tight truncate">
        {title}
      </h1>
      <ExecAvatarMenu fullName={fullName} />
    </header>
  );
}
