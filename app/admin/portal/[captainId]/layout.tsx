import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { db } from '@/db/client';
import { users } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { CAPTAIN_NAV_ITEMS } from '@/lib/captain/nav';
import { Icon } from '@/components/ui/icon';

// =============================================================================
// Admin → Captain portal — read-only view shell
// =============================================================================
//
// Sandeep 2026-06-03: admin clicks a city tile on /admin/dashboard →
// lands on /admin/portal/[captainId]/dashboard. The portal shows the
// captain's view of THEIR data (mixed across whatever cities they own
// — captain dashboard semantic), inside the admin shell. Every page
// renders the same components the captain uses, with editing
// disabled (Ship 2 wires the disabled state across the per-page
// surfaces).
//
// This sub-layout wraps /admin/portal/[captainId]/* in:
//   1. A sticky "VIEW MODE — Admin viewing <captainName>" banner so
//      admin never forgets they're not the captain.
//   2. A horizontal nav strip mirroring CAPTAIN_NAV_ITEMS but with
//      hrefs rewritten to /admin/portal/[captainId]/<segment>.
//
// The outer /admin/layout.tsx already provides the admin sidebar +
// topbar + auth gate (super_admin only). We add to that here.
// =============================================================================

export default async function AdminCaptainPortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  // Next.js 16 typedRoutes generates LayoutProps with params typed as
  // Promise<unknown>; narrow on assignment to keep the body clean.
  params: Promise<unknown>;
}) {
  const session = await getServerSession();
  const { captainId } = (await params) as { captainId: string };
  if (!session) {
    redirect(`/login?next=/admin/portal/${captainId}/dashboard`);
  }
  if ((session.user as { role?: string }).role !== 'super_admin') {
    redirect('/login');
  }
  const [captain] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      role: users.role,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, captainId))
    .limit(1);

  if (!captain || captain.role !== 'captain') notFound();

  const basePath = `/admin/portal/${captainId}`;

  return (
    <div className="flex flex-col">
      {/* View-mode banner — sticky so the context never scrolls off. */}
      <div className="sticky top-0 z-30 border-b border-amber-500/30 bg-amber-50/95 dark:bg-amber-900/30 backdrop-blur px-4 sm:px-6 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Icon
            name="visibility"
            size="sm"
            className="text-amber-700 dark:text-amber-300 shrink-0"
          />
          <p className="text-xs sm:text-sm text-amber-900 dark:text-amber-200 min-w-0">
            <span className="font-semibold">View mode</span>
            <span className="hidden sm:inline">
              {' '}
              — Admin viewing{' '}
              <span className="font-semibold">
                {captain.fullName ?? 'Captain'}
              </span>
              's portal
            </span>
            <span className="sm:hidden font-semibold ml-1">
              {captain.fullName ?? 'Captain'}
            </span>
            {!captain.isActive && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-rose-700 dark:text-rose-300">
                Inactive
              </span>
            )}
          </p>
        </div>
        <Link
          href="/admin/dashboard"
          className="text-xs text-amber-900 dark:text-amber-200 hover:underline inline-flex items-center gap-1 shrink-0"
        >
          <Icon name="arrow_back" size="xs" />
          Exit
        </Link>
      </div>

      {/* Secondary nav strip — horizontal scroll on small screens. */}
      <nav
        aria-label="Captain portal navigation"
        className="border-b bg-card/80 backdrop-blur"
      >
        <ul className="flex gap-1 overflow-x-auto px-4 sm:px-6 py-2 scrollbar-thin">
          {CAPTAIN_NAV_ITEMS.map((item) => {
            const segment = item.href.replace(/^\/captain/, '');
            const href = `${basePath}${segment}`;
            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={href}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-background hover:bg-accent px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap"
                >
                  <Icon name={item.icon} size="xs" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Page content */}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
