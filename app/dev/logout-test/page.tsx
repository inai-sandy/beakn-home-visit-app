import type { Metadata } from "next";
import Link from "next/link";

import { Icon } from "@/components/ui/icon";
import { getServerSession } from "@/lib/auth-server";

import { LogoutTrigger } from "./logout-trigger";

// =============================================================================
// HVA-28: /dev/logout-test — TEMPORARY home for the Logout flow
// =============================================================================
//
// The HVA-28 spec puts the Logout trigger on the Profile screen, but the
// Profile screen is HVA-76 and doesn't exist yet. This /dev page hosts the
// trigger + confirmation modal so the flow can be exercised end-to-end in
// the meantime. When HVA-76 lands, MOVE <LogoutTrigger /> into Profile and
// delete this directory. The Server Action under ./actions.ts is route-
// agnostic and should also move to a shared location at the same time.
// =============================================================================

export const metadata: Metadata = {
  title: "Logout test — Beakn dev",
  description: "Dev-only host for the HVA-28 logout flow (moves to Profile in HVA-76).",
  robots: { index: false, follow: false },
};

// Force-dynamic so the session lookup runs per request — without this, the
// page could be statically rendered with a stale session snapshot.
export const dynamic = "force-dynamic";

export default async function LogoutTestPage() {
  const session = await getServerSession();

  return (
    <main className="min-h-svh flex flex-col items-center justify-start px-6 py-10 bg-background">
      <div className="w-full max-w-md flex flex-col items-stretch gap-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Logout test
          </h1>
          <p className="text-sm text-muted-foreground">
            Dev-only host for the HVA-28 logout flow. The real trigger ships
            on the Profile screen in HVA-76.
          </p>
        </header>

        {session ? (
          (() => {
            const user = session.user as {
              id: string;
              name?: string;
              fullName?: string;
              role?: string;
            };
            const displayName = user.fullName ?? user.name ?? user.id;
            return (
              <section className="rounded-3xl border bg-card p-6 space-y-4 shadow-sm">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Signed in as
                  </p>
                  <p className="text-base font-semibold tracking-tight">
                    {displayName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    role: {user.role ?? "—"}
                    {" · "}
                    session id:{" "}
                    <code className="font-mono">{session.session.id}</code>
                  </p>
                </div>

                <LogoutTrigger />
              </section>
            );
          })()
        ) : (
          <section className="rounded-3xl border bg-muted/40 p-6 space-y-3 text-center">
            <Icon name="logout" size="lg" className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              You&apos;re not signed in — nothing to log out from.
            </p>
            <Link
              href="/login"
              className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              Go to sign in →
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
