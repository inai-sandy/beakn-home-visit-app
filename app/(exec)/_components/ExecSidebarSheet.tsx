'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

import { logoutAction } from '@/app/dev/logout-test/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  EXEC_DRAWER_NAV,
  isExecNavItemActive,
} from '@/lib/exec-nav';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-51: Sales exec mobile sidebar drawer
// =============================================================================
//
// Mobile-only left drawer (Sheet, side="left", 280px wide). Mirrors the
// HVA-152 CaptainSidebarSheet structure beat-for-beat — identity block,
// nav list, logout footer.
//
// Why the trigger lives in this component (not on the topbar): keeps the
// open/close state colocated with the Sheet. ExecMobileTopbar embeds
// <ExecSidebarSheet /> as its left-slot child.
//
// Drawer closes whenever the route changes (useEffect on pathname) + per-
// item onClick fallback. Both cover the same case; the useEffect catches
// browser-history navigation that bypasses the Link onClick.
// =============================================================================

interface SidebarCity {
  id: string;
  name: string;
}

interface Props {
  fullName: string;
  captainName: string | null;
  cities: SidebarCity[];
}

export function ExecSidebarSheet({ fullName, captainName, cities }: Props) {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const [pendingLogout, startLogout] = useTransition();

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
        aria-label="Sales executive navigation"
      >
        {/* Identity block — logo + name + reports-to + cities */}
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
              Executive
            </p>
            <p className="text-base font-semibold tracking-tight truncate">
              {fullName}
            </p>
          </div>
          {captainName && (
            <p className="text-xs text-muted-foreground">
              Reports to{' '}
              <span className="text-foreground/80">{captainName}</span>
            </p>
          )}
          {cities.length > 0 && (
            <div
              className="flex flex-wrap gap-1.5"
              aria-label="Cities served"
            >
              {cities.map((c) => (
                <Badge
                  key={c.id}
                  variant="secondary"
                  className="text-[10px] uppercase tracking-wide px-2 py-0.5"
                >
                  {c.name}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Nav — 44dp tap targets, matches HVA-152 D3. */}
        <nav
          className="flex-1 overflow-y-auto px-2 py-3"
          aria-label="Sections"
        >
          <ul className="space-y-0.5">
            {EXEC_DRAWER_NAV.map((item) => {
              const active = isExecNavItemActive(item, pathname);
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
                        name={item.icon}
                        size="sm"
                        className={
                          active ? 'text-primary' : 'text-muted-foreground'
                        }
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.isStub && (
                      <Badge
                        variant="outline"
                        className="text-[9px] uppercase tracking-wide"
                      >
                        Soon
                      </Badge>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer logout — mirrors desktop sidebar (HVA-116). */}
        <div className="border-t p-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-start h-11"
            disabled={pendingLogout}
            onClick={() => startLogout(() => logoutAction())}
          >
            <Icon name="logout" size="xs" />
            <span>{pendingLogout ? 'Signing out…' : 'Sign out'}</span>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
