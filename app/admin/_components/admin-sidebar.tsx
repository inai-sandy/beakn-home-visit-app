"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Icon } from "@/components/ui/icon";
import {
  ADMIN_NAV,
  isAdminNavItemActive,
  isAdminNavSubgroupActive,
  type AdminNavItem,
  type AdminNavSubgroup,
} from "@/lib/admin-nav";
import { cn } from "@/lib/utils";

// =============================================================================
// HVA-86 + HVA-89: admin shell sidebar
// =============================================================================
//
// 240px fixed-width column rendered on the left of every /admin/* page.
// Client component because the active-state highlight depends on
// `usePathname` + `useSearchParams`. Nav config + active detection live
// in lib/admin-nav.ts so the same source drives the topbar title.
//
// The Settings group renders as collapsible accordions (HVA-89 6-card spec).
// Each subgroup's default-expanded state matches whether any of its leaves
// is the currently-active URL; once the user manually toggles, that
// override persists for the page lifetime.
// =============================================================================

export function AdminSidebar({
  userFooter,
}: {
  userFooter: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/admin";
  const searchParams = useSearchParams();

  return (
    <aside className="w-60 shrink-0 border-r bg-card flex flex-col">
      {/* Logo + wordmark */}
      <header className="h-16 flex items-center gap-3 px-5 border-b">
        <Image
          src="/icon-512x512.png"
          alt="Beakn"
          width={32}
          height={32}
          priority
          className="rounded-md"
        />
        <span className="text-base font-semibold tracking-tight">
          Beakn Admin
        </span>
      </header>

      {/* Grouped nav */}
      <nav
        aria-label="Admin navigation"
        className="flex-1 overflow-y-auto py-4 px-3 space-y-5"
      >
        {ADMIN_NAV.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.label}
            </p>
            {group.items && (
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLeaf
                    key={`${group.label}-${item.label}`}
                    item={item}
                    pathname={pathname}
                    searchParams={searchParams}
                    groupLabel={group.label}
                  />
                ))}
              </ul>
            )}
            {group.subgroups && (
              <div className="space-y-1">
                {group.subgroups.map((sg) => (
                  <SubgroupAccordion
                    key={`${group.label}-${sg.label}`}
                    subgroup={sg}
                    pathname={pathname}
                    searchParams={searchParams}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="border-t p-3">{userFooter}</div>
    </aside>
  );
}

// -----------------------------------------------------------------------------
// Leaf link
// -----------------------------------------------------------------------------

function NavLeaf({
  item,
  pathname,
  searchParams,
  groupLabel,
}: {
  item: AdminNavItem;
  pathname: string;
  searchParams: URLSearchParams | null;
  groupLabel: string;
}) {
  const active = isAdminNavItemActive(item, pathname, searchParams);
  if (item.placeholder || !item.href) {
    return (
      <li>
        <span
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground/60 cursor-not-allowed select-none"
          aria-disabled="true"
          title="Coming soon"
        >
          <Icon name={item.icon} size="sm" />
          <span>{item.label}</span>
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
        data-group={groupLabel}
        className={cn(
          "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
          active
            ? "bg-primary/10 text-primary font-medium"
            : "text-foreground hover:bg-muted/60",
        )}
        aria-current={active ? "page" : undefined}
      >
        <Icon name={item.icon} size="sm" />
        <span>{item.label}</span>
      </Link>
    </li>
  );
}

// -----------------------------------------------------------------------------
// Settings subgroup accordion
// -----------------------------------------------------------------------------

function SubgroupAccordion({
  subgroup,
  pathname,
  searchParams,
}: {
  subgroup: AdminNavSubgroup;
  pathname: string;
  searchParams: URLSearchParams | null;
}) {
  const activeMatch = isAdminNavSubgroupActive(subgroup, pathname, searchParams);
  const [expanded, setExpanded] = useState<boolean>(activeMatch);

  // Re-sync expanded state when the URL changes to a leaf inside this
  // subgroup — useful when admin uses the redirect from the legacy /admin/captains URL.
  useEffect(() => {
    if (activeMatch) setExpanded(true);
  }, [activeMatch]);

  if (subgroup.comingSoon) {
    return (
      <div
        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground/60 cursor-not-allowed select-none"
        aria-disabled="true"
        title="Coming soon"
      >
        <Icon name={subgroup.icon} size="sm" />
        <span className="flex-1">{subgroup.label}</span>
        <span className="text-[9px] uppercase tracking-wide">Soon</span>
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
        aria-controls={`subgroup-${subgroup.label}`}
        className={cn(
          "w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
          activeMatch
            ? "text-foreground font-medium"
            : "text-foreground/80 hover:bg-muted/60",
        )}
      >
        <Icon
          name={subgroup.icon}
          size="sm"
          className={activeMatch ? "text-primary" : "text-muted-foreground"}
        />
        <span className="flex-1 text-left">{subgroup.label}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {count}
        </span>
        <Icon
          name="expand_more"
          size="xs"
          className={cn(
            "transition-transform text-muted-foreground",
            expanded ? "rotate-180" : "",
          )}
        />
      </button>
      {expanded && (
        <ul
          id={`subgroup-${subgroup.label}`}
          className="ml-3 mt-0.5 mb-1 pl-3 border-l border-border space-y-0.5"
        >
          {subgroup.items.map((item) => (
            <NavLeaf
              key={`${subgroup.label}-${item.label}`}
              item={item}
              pathname={pathname}
              searchParams={searchParams}
              groupLabel={subgroup.label}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
