'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Icon } from '@/components/ui/icon';
import { SUPPORT_NAV } from '@/lib/support/nav';
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
// =============================================================================

interface Props {
  fullName: string;
}

export function SupportSidebar({ fullName }: Props) {
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
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                active
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              <Icon name={item.iconName} size="sm" />
              <span>{item.label}</span>
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
