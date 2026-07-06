'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import {
  SUPPORT_NAV,
  type SupportNavCounts,
  supportNavCountFor,
} from '@/lib/support/nav';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-235: SupportSidebar — desktop sidebar for /support/*
// =============================================================================
//
// 240px persistent sidebar at `lg:` and above. Mobile uses the drawer
// pattern (SupportSidebarSheet, mirrors captain + exec shells).
//
// Active route gets the primary-color background tint + slightly bolder
// label. Icon-only state isn't supported in v1 — sidebar is always full
// width when visible.
//
// HVA-231 Phase 2: backlog count badges next to Pending / In-progress /
// Orders, mirroring the captain sidebar's outline-pill counter treatment.
// =============================================================================

interface Props {
  fullName: string;
  navCounts?: SupportNavCounts;
}

export function SupportSidebar({ fullName, navCounts }: Props) {
  const pathname = usePathname();

  return (
    <aside
      aria-label="Support navigation"
      className="w-60 shrink-0 border-r bg-card/50 flex flex-col"
    >
      <div className="px-4 py-5 border-b">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Support team
        </p>
        <p className="text-sm font-semibold mt-1 truncate">{fullName}</p>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-1">
        {SUPPORT_NAV.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== '/support' && pathname.startsWith(`${item.href}/`));
          const count = supportNavCountFor(item.href, navCounts);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center justify-between gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                active
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              <span className="inline-flex items-center gap-3 min-w-0">
                <Icon name={item.iconName} size="sm" />
                <span className="truncate">{item.label}</span>
              </span>
              {count !== null && count > 0 && (
                <Badge
                  variant="outline"
                  className="text-[9px] tabular-nums border-primary/50 text-primary"
                  aria-label={`${count} in ${item.label}`}
                >
                  {count > 99 ? '99+' : count}
                </Badge>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t text-[11px] text-muted-foreground">
        Support portal v1
      </div>
    </aside>
  );
}
