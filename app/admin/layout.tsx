import { redirect } from "next/navigation";

import { decideAdminAccess } from "@/lib/admin-authz";
import { getServerSession } from "@/lib/auth-server";

import { AdminSidebar } from "./_components/admin-sidebar";
import { AdminTopbar } from "./_components/admin-topbar";
import { AdminUserFooter } from "./_components/admin-user-footer";

// =============================================================================
// HVA-86: super-admin app shell — sidebar + topbar + content area
// =============================================================================
//
// Wraps every /admin/* route. Server component that performs the role
// gate via lib/admin-authz.ts (the same logic proxy.ts applies upstream
// — defence in depth, matches the HVA-110 pattern of route-level
// re-validation). The 4 shipped admin pages keep their own per-page
// redirect calls; those remain authoritative — this layout just makes
// the shell behave correctly when the page itself didn't enforce.
//
// Authz decisions:
//   * anonymous       → /login?next=<current path>
//   * super_admin     → render shell
//   * captain/exec    → ROLE_HOME redirect (Role-typed)
//   * unknown role    → /login (defensive)
//
// Layout is not a route group (`app/(admin)/layout.tsx`) — the existing
// admin pages live under `app/admin/*` and Next applies this layout to
// every page beneath it. The route-group syntax in the brief was a
// loose reference; the URL semantics are identical.
// =============================================================================

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  // Defence-in-depth — proxy.ts is the primary gate and seeds its own
  // `?next=` query with the full attempted URL. We default to
  // /admin/dashboard here as the safe post-login landing since the layout
  // doesn't have access to the original request URL in a server component
  // context.
  const decision = decideAdminAccess(session, "/admin/dashboard");
  if (!decision.allow) {
    redirect(decision.redirectTo);
  }

  // Better-Auth exposes the user's name as `name` on session.user (mapped
  // to our `full_name` column via lib/auth.ts user.fields.name = 'fullName').
  const user = session!.user as { name?: string; role: string; email?: string };
  const displayName = user.name ?? user.email ?? "Admin";

  return (
    <div className="min-h-svh flex bg-background">
      <AdminSidebar
        userFooter={<AdminUserFooter fullName={displayName} role={user.role} />}
      />
      {/*
        Outer wrapper is a plain <div>, not <main>: every existing
        /admin/* page already renders its own <main> element. Having two
        <main> per document is invalid HTML. When those pages move to a
        purely-children layout (no nested <main>), promote this back to
        <main>.
      */}
      <div className="flex-1 flex flex-col min-w-0">
        <AdminTopbar />
        <div className="flex-1 overflow-x-auto">{children}</div>
      </div>
    </div>
  );
}
