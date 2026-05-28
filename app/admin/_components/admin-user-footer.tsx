"use client";

import { useTransition } from "react";

import { logoutAction } from "@/lib/auth/logout-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// =============================================================================
// HVA-86: admin shell user footer
// =============================================================================
//
// Bottom slot of the sidebar. Shows the signed-in user's name + role
// badge, plus a Logout button that invokes the shared signOut server
// action. The action handles its own redirect; the only client-side
// concern is the in-flight state on the button.
// =============================================================================

export function AdminUserFooter({
  fullName,
  role,
}: {
  fullName: string;
  role: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 min-w-0">
        <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
          {initials(fullName)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{fullName}</p>
          <Badge variant="outline" className="text-[9px] mt-0.5">
            {role}
          </Badge>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full justify-start h-9"
        disabled={pending}
        onClick={() => startTransition(() => logoutAction())}
      >
        <Icon name="logout" size="xs" />
        <span>{pending ? "Signing out…" : "Sign out"}</span>
      </Button>
    </div>
  );
}

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/u);
  if (parts.length === 0 || parts[0] === "") return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
