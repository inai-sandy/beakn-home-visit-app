import type { Metadata } from "next";
import Image from "next/image";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in — Beakn",
  description: "Sign in to Beakn.",
};

// /login is the INTERNAL login for sales execs, captains, super admins.
// Customers don't have accounts and never visit this page — they use the
// public visit-request form (HVA-30+) instead. Routing to a role-specific
// home after sign-in is HVA-25's job.
export default function LoginPage() {
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
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
