'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  SUPPORT_NAV,
  activeSupportNav,
  type SupportNavCounts,
  supportNavCountFor,
} from '@/lib/support/nav';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-231 Phase 2: Support mobile sidebar drawer
// =============================================================================
//
// Mobile-only left drawer (Sheet, side="left", 280px wide). Mirrors the
// HVA-152 CaptainSidebarSheet / HVA-51 ExecSidebarSheet structure
// beat-for-beat — identity block, nav list with backlog count badges.
//
// The hamburger trigger lives inside this component (SheetTrigger) so the
// open/close state is colocated with the Sheet; SupportTopbar embeds
// <SupportSidebarSheet /> as its left-slot child. `lg:hidden` on the
// trigger hides the whole control at desktop sizes, where the persistent
// <SupportSidebar> takes over.
//
// Drawer closes whenever the route changes (useEffect on pathname) + a
// per-item onClick fallback, matching the captain/exec drawers.
// =============================================================================

interface Props {
  fullName: string;
  navCounts?: SupportNavCounts;
}

export function SupportSidebarSheet({ fullName, navCounts }: Props) {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open menu"
          className="lg:hidden inline-flex items-center justify-center h-11 w-11 -ml-2 rounded-md hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon name="menu" size="sm" />
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[280px] sm:max-w-[280px] p-0 flex flex-col"
        aria-label="Support navigation"
      >
        {/* Identity block — logo + role + name. */}
        <div className="px-4 py-6 space-y-3 border-b">
          <div className="flex items-center gap-3">
            <Image
              src="/icon-512x512.png"
              alt="Beakn"
              width={32}
              height={32}
              priority
              className="rounded-md shrink-0"
            />
            <span className="text-base font-semibold tracking-tight">Beakn</span>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Support team
            </p>
            <p className="text-base font-semibold tracking-tight truncate">
              {fullName}
            </p>
          </div>
        </div>

        {/* Nav — 44dp tap targets, matches HVA-152 D3. */}
        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Sections">
          <ul className="space-y-0.5">
            {SUPPORT_NAV.map((item) => {
              const active = activeSupportNav(pathname)?.href === item.href;
              const count = supportNavCountFor(item.href, navCounts);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'group flex items-center justify-between gap-3 h-11 px-3 rounded-md text-sm transition-colors',
                      active
                        ? 'bg-primary/10 text-primary font-semibold'
                        : 'text-foreground/80 hover:bg-muted/60 hover:text-foreground',
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span className="inline-flex items-center gap-3 min-w-0">
                      <Icon
                        name={item.iconName}
                        size="sm"
                        className={
                          active ? 'text-primary' : 'text-muted-foreground'
                        }
                      />
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
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t px-4 py-3 text-[11px] text-muted-foreground">
          Support portal v1
        </div>
      </SheetContent>
    </Sheet>
  );
}
