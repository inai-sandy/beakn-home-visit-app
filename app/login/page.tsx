import type { Metadata } from "next";
import Image from "next/image";
import { Suspense } from "react";

import { getConfig } from "@/lib/config";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in — Beakn",
  description: "Sign in to Beakn.",
};

// Re-read the config row on every request so admins changing the support
// phone via the Settings Hub (HVA-?? config UI) see it reflected on /login
// within one config-cache TTL (60s, HVA-17). Without force-dynamic, Next
// could static-render this page once at build and freeze the phone string.
export const dynamic = "force-dynamic";

// /login is the INTERNAL login for sales execs, captains, super admins.
// Customers don't have accounts and never visit this page — they use the
// public visit-request form (HVA-30+) instead. Routing to a role-specific
// home after sign-in is HVA-25's job.
//
// HVA-27: the admin support phone for the Forgot Password modal is fetched
// here (server-side) and passed as a prop into the client form tree. The
// modal never touches the config service directly — keeps DB reads server-only.
export default async function LoginPage() {
  const adminPhoneRaw = await getConfig("admin_support_phone");
  const adminPhone = typeof adminPhoneRaw === "string" ? adminPhoneRaw : "";
  return (
    <main className="min-h-svh flex flex-col items-center justify-center px-6 py-10 bg-background">
      <div className="w-full max-w-md flex flex-col items-center">
        <Image
          src="/icon-512x512.png"
          alt="Beakn"
          width={88}
          height={88}
          priority
          className="mb-6 rounded-2xl"
        />
        <h1 className="text-2xl font-semibold tracking-tight text-center mb-1">
          Welcome to Beakn
        </h1>
        <p className="text-sm text-muted-foreground text-center mb-8">
          Sign in to continue
        </p>

        <div className="w-full sm:rounded-3xl sm:border sm:bg-card sm:p-6 sm:shadow-sm">
          {/* LoginForm uses useSearchParams() (to honour ?next= from HVA-25's
              proxy redirect). Next 16 requires a Suspense boundary for that. */}
          <Suspense fallback={null}>
            <LoginForm adminPhone={adminPhone} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
