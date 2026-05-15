import type { Metadata } from "next";
import Image from "next/image";
import Script from "next/script";

import { RequestForm } from "./request-form";

// =============================================================================
// HVA-30 (layout shell) + HVA-31 (real form fields): public /request landing
// =============================================================================
//
// PUBLIC ROUTE. /request is in proxy.ts PUBLIC_PAGE_PREFIXES; anyone can
// reach this page (no session, no auth redirect). Logged-in users see the
// same form — we don't redirect based on auth state, since customers and
// staff may share devices.
//
// HVA-31 swapped the 3 placeholder Inputs + RequestSubmitButton for the
// real 8-field form (see ./request-form.tsx). Today's submit is still a
// validate-then-toast no-op; HVA-33 wires the Server Action, HVA-32 the
// token, HVA-35 the /success/<token> redirect.
//
// LAYOUT NOTES (preserved from HVA-30):
//   - Mobile-first. Container max-w-md on mobile, sm:max-w-lg on desktop.
//   - Logo: /icon-512x512.png at 88×88, rounded-2xl. Same asset as /login.
//   - Form container: rounded-3xl (--radius-modal 24px) M3 elevated card.
//   - Hero copy is now locked ("Smart home automation, designed for your
//     home."). Future copy changes own this exact string; placeholder copy
//     era ended at HVA-31.
//   - No marketing fluff below the form. Form completion is the only goal.
// =============================================================================

export const metadata: Metadata = {
  title: "Request a free home visit — Beakn",
  description: "Smart home automation, designed for your home.",
};

// /request must not be cached statically: HVA-33's submit Server Action and
// HVA-35's success redirect both add dynamic behaviour. Pin dynamic here so
// future iterations don't trip over a stale static build.
export const dynamic = "force-dynamic";

export default function RequestPage() {
  return (
    <main className="min-h-svh flex flex-col items-center px-6 py-10 bg-background">
      {/* HVA-34: Cloudflare Turnstile script. Scoped to /request only —
          this page is the sole consumer; loading it from app/layout.tsx
          would ship the script to every route. afterInteractive runs
          after hydration so the widget container exists by the time
          window.turnstile.render is called from request-form.tsx. */}
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        async
        defer
      />

      <div className="w-full max-w-md sm:max-w-lg flex flex-col items-stretch gap-8">
        {/* Logo + hero */}
        <header className="flex flex-col items-center gap-4 pt-4">
          <Image
            src="/icon-512x512.png"
            alt="Beakn"
            width={88}
            height={88}
            priority
            className="rounded-2xl"
          />
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-center text-balance">
            Smart home automation, designed for your home.
          </h1>
        </header>

        {/* Form container — M3 surface, 24dp radius. RequestForm owns the
            real 8 fields + onBlur validation + placeholder submit. */}
        <section
          aria-label="Request a home visit"
          className="rounded-3xl border bg-card p-6 sm:p-8 shadow-sm"
        >
          <RequestForm />
        </section>
      </div>
    </main>
  );
}
