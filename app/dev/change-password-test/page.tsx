import type { Metadata } from "next";
import Link from "next/link";

import { getServerSession } from "@/lib/auth-server";

import { ChangePasswordForm } from "./change-password-form";

// =============================================================================
// HVA-29: /dev/change-password-test — TEMPORARY host
// =============================================================================
//
// The HVA-29 spec puts the Change Password form under a "Change Password"
// section on the Profile screen, but Profile is HVA-76 and doesn't exist
// yet. This /dev page hosts the form so the flow can be exercised end-to-
// end in the meantime. When HVA-76 lands:
//   - Move <ChangePasswordForm /> into the Profile screen, inside the
//     "Change Password" section as spec'd.
//   - Move actions.ts to a shared location next to the Profile route's
//     other server actions.
//   - Delete this /dev/change-password-test directory.
// No code outside this directory needs to change.
// =============================================================================

export const metadata: Metadata = {
  title: "Change password — Beakn dev",
  description:
    "Dev-only host for the HVA-29 change-password flow (moves to Profile in HVA-76).",
  robots: { index: false, follow: false },
};

// Force-dynamic so the session lookup runs per request — without this, the
// page could be statically rendered with a stale session snapshot.
export const dynamic = "force-dynamic";

export default async function ChangePasswordTestPage() {
  const session = await getServerSession();

  return (
    <main className="min-h-svh flex flex-col items-center justify-start px-6 py-10 bg-background">
      <div className="w-full max-w-md flex flex-col items-stretch gap-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Change password
          </h1>
          <p className="text-sm text-muted-foreground">
            Dev-only host for the HVA-29 change-password flow. The real
            section ships on the Profile screen in HVA-76.
          </p>
        </header>

        {session ? (
          <section className="rounded-3xl border bg-card p-6 space-y-5 shadow-sm">
            <header className="space-y-1">
              <h2 className="text-base font-semibold tracking-tight">
                Change Password
              </h2>
              <p className="text-xs text-muted-foreground">
                Updating your password will sign you out of all other
                devices. This device stays signed in.
              </p>
            </header>

            <ChangePasswordForm />
          </section>
        ) : (
          <section className="rounded-3xl border bg-muted/40 p-6 space-y-3 text-center">
            <p className="text-sm text-muted-foreground">
              You need to be signed in to change your password.
            </p>
            <Link
              href="/login?next=/dev/change-password-test"
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
