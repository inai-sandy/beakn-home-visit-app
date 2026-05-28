"use client";

import Link from "next/link";
import { useTransition } from "react";

import { logoutAction } from "@/lib/auth/logout-action";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";

// =============================================================================
// HVA-115: top-bar avatar dropdown — Profile + Logout
// =============================================================================
//
// Rendered as the right slot on the mobile/tablet top bar. The trigger is
// a circular initials avatar; tapping it opens a dropdown anchored to
// the avatar with two items:
//
//   1. Profile  → links to /profile (stub today; HVA-76 ships the page).
//   2. Logout   → invokes the HVA-28 logoutAction. Same action the admin
//                 shell footer + dev/logout-test consume — it handles
//                 BA signOut, session-row delete, cookie clear, audit
//                 row, and the post-logout redirect to /login.
//
// Initials are derived from the user's display name client-side. If we
// later move to avatar images, swap the SVG circle for an <Image>.
// =============================================================================

interface ExecAvatarMenuProps {
  fullName: string;
}

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/u);
  if (parts.length === 0 || parts[0] === "") return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ExecAvatarMenu({ fullName }: ExecAvatarMenuProps) {
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${fullName}`}
          className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {initials(fullName)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="truncate">{fullName}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile" className="cursor-pointer">
            <Icon name="person" size="sm" />
            <span>Profile</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={pending}
          onSelect={(e) => {
            // Prevent the menu from auto-closing before the transition
            // fires — once the redirect lands, the whole page unmounts
            // and the menu state is gone anyway.
            e.preventDefault();
            startTransition(() => logoutAction());
          }}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <Icon name="logout" size="sm" />
          <span>{pending ? "Signing out…" : "Logout"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
