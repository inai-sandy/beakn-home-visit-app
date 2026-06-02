"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  ADMIN_NAV,
  isAdminNavItemActive,
  isAdminNavSubgroupActive,
  type AdminNavItem,
  type AdminNavSubgroup,
} from "@/lib/admin-nav";
import { logoutAction } from "@/lib/auth/logout-action";
import { cn } from "@/lib/utils";

// =============================================================================
// HVA-117: Admin mobile sidebar drawer
// =============================================================================
//
// Pattern: hamburger button in the AdminMobileTopbar opens a Sheet from
// the left (280px wide). Drawer body mirrors the desktop AdminSidebar's
// nav structure — logo + wordmark + grouped nav (Operations / Settings /
// Reports) + user footer + logout — but with mobile-specific spacing
// (44dp tap targets, generous padding) and accordion behaviour for the
// Settings subgroups (Organization / Audit & Content / Notifications /
// etc.) per the existing HVA-89 6-card spec.
//
// Rendered with `lg:hidden` on the OUTER trigger so the entire control
// disappears at desktop sizes. Desktop continues to use the persistent
// `<AdminSidebar>` exactly as before.
//
// Drawer auto-closes on route change via the pathname-watcher effect.
// =============================================================================

interface Props {
  displayName: string;
  role: string;
  /** HVA-77 + HVA-94: pending admin help count drives the badge next to
   *  the "Admin Help Inbox" nav item. */
  pendingHelpCount?: number;
}

export function AdminSidebarSheet({
  displayName,
  role,
  pendingHelpCount = 0,
}: Props) {
  const pathname = usePathname() ?? "/admin";
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  // eslint-disable-next-line no-restricted-syntax -- HVA-149: logoutAction returns Promise<void>, not ActionResult
  const [pendingLogout, startLogout] = useTransition();

  // Close drawer on any route change.
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
        className="w-[280px] sm:max-w-[280px] p-0 flex flex-col"
        aria-label="Admin navigation"
      >
        {/* Identity block — logo + wordmark, then admin name + role. */}
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
              Beakn Admin
            </span>
          </div>
          <div className="space-y-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {role.replace(/_/g, " ")}
            </p>
            <p className="text-base font-semibold tracking-tight truncate">
              {displayName}
            </p>
          </div>
        </div>

        {/* Grouped nav. */}
        <nav
          className="flex-1 overflow-y-auto py-4 px-3 space-y-5"
          aria-label="Admin sections"
        >
          {ADMIN_NAV.map((group) => (
            <div key={group.label} className="space-y-1">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              {group.items && (
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <MobileNavLeaf
                      key={`${group.label}-${item.label}`}
                      item={item}
                      pathname={pathname}
                      searchParams={searchParams}
                      onNavigate={() => setOpen(false)}
                      badgeCount={
                        item.label === "Admin Help Inbox" ? pendingHelpCount : 0
                      }
                    />
                  ))}
                </ul>
              )}
              {group.subgroups && (
                <div className="space-y-1">
                  {group.subgroups.map((sg) => (
                    <MobileSubgroupAccordion
                      key={`${group.label}-${sg.label}`}
                      subgroup={sg}
                      pathname={pathname}
                      searchParams={searchParams}
                      onNavigate={() => setOpen(false)}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Footer logout — mirrors captain pattern. */}
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
            <span>{pendingLogout ? "Signing out…" : "Sign out"}</span>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// -----------------------------------------------------------------------------
// Mobile nav leaf — 44dp tap target, badge support, auto-closes drawer.
// -----------------------------------------------------------------------------

function MobileNavLeaf({
  item,
  pathname,
  searchParams,
  onNavigate,
  badgeCount = 0,
}: {
  item: AdminNavItem;
  pathname: string;
  searchParams: URLSearchParams | null;
  onNavigate: () => void;
  badgeCount?: number;
}) {
  const active = isAdminNavItemActive(item, pathname, searchParams);

  if (item.placeholder || !item.href) {
    return (
      <li>
        <span
          className="flex items-center gap-3 h-11 px-3 rounded-md text-sm text-muted-foreground/60 cursor-not-allowed select-none"
          aria-disabled="true"
          title="Coming soon"
        >
          <Icon name={item.icon} size="sm" />
          <span className="flex-1 truncate">{item.label}</span>
        </span>
      </li>
    );
  }

  const href =
    item.query && Object.keys(item.query).length > 0
      ? `${item.href}?${new URLSearchParams(item.query).toString()}`
      : item.href;

  return (
    <li>
      <Link
        href={href}
        onClick={onNavigate}
        className={cn(
          "group flex items-center justify-between gap-3 h-11 px-3 rounded-md text-sm transition-colors",
          active
            ? "bg-primary/10 text-primary font-semibold"
            : "text-foreground/80 hover:bg-muted/60 hover:text-foreground",
        )}
        aria-current={active ? "page" : undefined}
      >
        <span className="inline-flex items-center gap-3 min-w-0">
          <Icon
            name={item.icon}
            size="sm"
            className={active ? "text-primary" : "text-muted-foreground"}
          />
          <span className="truncate">{item.label}</span>
        </span>
        {badgeCount > 0 && (
          <Badge
            variant="outline"
            className="text-[9px] tabular-nums border-primary/50 text-primary shrink-0"
            aria-label={`${badgeCount} pending`}
          >
            {badgeCount > 99 ? "99+" : badgeCount}
          </Badge>
        )}
      </Link>
    </li>
  );
}

// -----------------------------------------------------------------------------
// Settings subgroup accordion (mirrors desktop AdminSidebar accordion).
// -----------------------------------------------------------------------------

function MobileSubgroupAccordion({
  subgroup,
  pathname,
  searchParams,
  onNavigate,
}: {
  subgroup: AdminNavSubgroup;
  pathname: string;
  searchParams: URLSearchParams | null;
  onNavigate: () => void;
}) {
  const activeMatch = isAdminNavSubgroupActive(
    subgroup,
    pathname,
    searchParams,
  );
  const [expanded, setExpanded] = useState<boolean>(activeMatch);

  useEffect(() => {
    if (activeMatch) setExpanded(true);
  }, [activeMatch]);

  if (subgroup.comingSoon) {
    return (
      <div
        className="flex items-center gap-3 h-11 px-3 rounded-md text-sm text-muted-foreground/60 cursor-not-allowed select-none"
        aria-disabled="true"
        title="Coming soon"
      >
        <Icon name={subgroup.icon} size="sm" />
        <span className="flex-1 truncate">{subgroup.label}</span>
        <span className="text-[9px] uppercase tracking-wide shrink-0">
          Soon
        </span>
      </div>
    );
  }

  const count = subgroup.items.length;

  return (
    <div className="rounded-md">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={`mobile-subgroup-${subgroup.label}`}
        className={cn(
          "w-full flex items-center gap-3 h-11 px-3 rounded-md text-sm transition-colors",
          activeMatch
            ? "text-foreground font-semibold"
            : "text-foreground/80 hover:bg-muted/60",
        )}
      >
        <Icon
          name={subgroup.icon}
          size="sm"
          className={activeMatch ? "text-primary" : "text-muted-foreground"}
        />
        <span className="flex-1 text-left truncate">{subgroup.label}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {count}
        </span>
        <Icon
          name="expand_more"
          size="xs"
          className={cn(
            "transition-transform text-muted-foreground shrink-0",
            expanded ? "rotate-180" : "",
          )}
        />
      </button>
      {expanded && (
        <ul
          id={`mobile-subgroup-${subgroup.label}`}
          className="ml-3 mt-0.5 mb-1 pl-3 border-l border-border space-y-0.5"
        >
          {subgroup.items.map((item) => (
            <MobileNavLeaf
              key={`${subgroup.label}-${item.label}`}
              item={item}
              pathname={pathname}
              searchParams={searchParams}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
