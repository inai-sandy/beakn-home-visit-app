"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { Icon } from "@/components/ui/icon";
import { ADMIN_NAV, isAdminNavItemActive } from "@/lib/admin-nav";
import { cn } from "@/lib/utils";

// =============================================================================
// HVA-86: admin shell sidebar
// =============================================================================
//
// 240px fixed-width column rendered on the left of every /admin/* page.
// Client component because the active-state highlight depends on
// `usePathname` + `useSearchParams`. Nav config + active detection live
// in lib/admin-nav.ts so the same source drives the topbar title.
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
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isAdminNavItemActive(item, pathname, searchParams);
                if (item.placeholder || !item.href) {
                  return (
                    <li key={`${group.label}-${item.label}`}>
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
                  <li key={`${group.label}-${item.label}`}>
                    <Link
                      href={href}
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
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="border-t p-3">{userFooter}</div>
    </aside>
  );
}
