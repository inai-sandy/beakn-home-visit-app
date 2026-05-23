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
  CAPTAIN_NAV_ITEMS,
  isCaptainNavItemActive,
} from '@/lib/captain/nav';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-152: Captain mobile sidebar drawer
// =============================================================================
//
// Pattern: hamburger button in the mobile topbar opens a Sheet from the
// left (280px wide). The drawer body mirrors the desktop sidebar's nav
// structure — logo + name + city badges + nav list + logout footer —
// but with mobile-specific spacing (44dp tap targets, generous padding).
//
// Rendered with `lg:hidden` on the OUTER trigger so the entire control
// disappears at desktop sizes. Desktop continues to use the persistent
// `<CaptainSidebar>` exactly as before.
//
// Drawer auto-closes when the user taps a nav item — controlled `open`
// state flipped to false on the item's onClick, then the navigation
// fires.
// =============================================================================

interface SidebarCity {
  id: string;
  name: string;
}

interface Props {
  captainName: string;
  cities: SidebarCity[];
  /** HVA-156: unread-count badge next to the Announcements item. */
  unreadAnnouncementsCount?: number;
}

export function CaptainSidebarSheet({
  captainName,
  cities,
  unreadAnnouncementsCount = 0,
}: Props) {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const [pendingLogout, startLogout] = useTransition();

  // Close the drawer whenever the route changes — covers nav clicks from
  // within the drawer + browser back/forward + any other navigation that
  // happens to fire while the drawer is open.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open menu"
          className="lg:hidden inline-flex items-center justify-center h-11 w-11 -ml-2 rounded-full text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon name="menu" size="sm" />
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        // Override the default Sheet width (sm:max-w-sm = 24rem). 280px
        // is the HVA-152 spec.
        className="w-[280px] sm:max-w-[280px] p-0 flex flex-col"
        aria-label="Captain navigation"
      >
        {/* Identity block — logo + bell-stub on top, then name + cities. */}
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
            <span className="text-base font-semibold tracking-tight">
              Beakn
            </span>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Captain
            </p>
            <p className="text-base font-semibold tracking-tight truncate">
              {captainName}
            </p>
          </div>
          {cities.length > 0 && (
            <div
              className="flex flex-wrap gap-1.5"
              aria-label="Assigned cities"
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

        {/* Nav — 44dp tap targets per HVA-152 D3. */}
        <nav
          className="flex-1 overflow-y-auto px-2 py-3"
          aria-label="Sections"
        >
          <ul className="space-y-0.5">
            {CAPTAIN_NAV_ITEMS.map((item) => {
              const active = isCaptainNavItemActive(item.href, pathname);
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
                    {item.href === '/captain/announcements' &&
                      unreadAnnouncementsCount > 0 && (
                        <Badge
                          variant="outline"
                          className="text-[9px] tabular-nums border-primary/50 text-primary"
                          aria-label={`${unreadAnnouncementsCount} unread announcements`}
                        >
                          {unreadAnnouncementsCount > 99
                            ? '99+'
                            : unreadAnnouncementsCount}
                        </Badge>
                      )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer logout — mirrors desktop sidebar's footer (HVA-116). */}
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
