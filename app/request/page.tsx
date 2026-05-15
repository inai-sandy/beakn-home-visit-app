import type { Metadata } from "next";
import Image from "next/image";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

import { RequestSubmitButton } from "./submit-button";

// =============================================================================
// HVA-30: customer landing — public request-form layout
// =============================================================================
//
// PUBLIC ROUTE. Anyone can reach this page; no session, no proxy redirect.
// /request is already in proxy.ts PUBLIC_PAGE_PREFIXES; verify there before
// changing the auth model.
//
// SCOPE:
//   - Page shell only. No real form fields, no validation, no submit handler.
//   - HVA-31 replaces the placeholder Field 1 / Field 2 / Field 3 inputs with
//     the real schema (name, phone, address, ...). HVA-35 owns the success-
//     screen redirect on submit. Until those land, the submit button fires a
//     Sonner info toast pointing at HVA-31 — see ./submit-button.tsx.
//
// LAYOUT NOTES (carry forward to HVA-31):
//   - Mobile-first. min-h-svh + flex-col so the form section grows but the
//     header (logo + hero) anchors top. Center column max-w-md (~448px) on
//     mobile/tablet; bump to max-w-lg (~512px) at sm+ for desktop comfort
//     without going wide.
//   - shadcn <Input> already uses rounded-input (--radius-input: 0.75rem /
//     12px) and a 1px border + focus ring. That matches M3 outlined without
//     a custom variant — DO NOT fork the component. To bump input height
//     from the default h-9 (36px), pass h-12 / h-14 via className when
//     HVA-31 wires the real fields.
//   - Submit: <Button> via RequestSubmitButton wrapper. 56dp on mobile
//     (h-14), 48dp on sm+ (sm:h-12), full width.
//   - Beakn wordmark uses the existing /icon-512x512.png asset — same as
//     /login. If branding ships a separate horizontal mark later, swap the
//     src here and on /login simultaneously.
//
// NO MARKETING. Form completion is the only goal — spec §1.1.
// =============================================================================

export const metadata: Metadata = {
  title: "Request a free home visit — Beakn",
  description:
    "Tell us about your home — we'll come visit, free of cost.",
};

// /request must not be cached statically: the form shell is static today,
// but HVA-31's submit will be server-action-driven and HVA-35 adds dynamic
// success-screen redirect logic. Pinning dynamic here so future iterations
// don't trip over a stale static build.
export const dynamic = "force-dynamic";

export default function RequestPage() {
  return (
    <main className="min-h-svh flex flex-col items-center px-6 py-10 bg-background">
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
            Tell us about your home — we&apos;ll come visit, free of cost.
          </h1>
        </header>

        {/* Form container — M3 surface, 20dp radius (rounded-card token).
            Single column inside; HVA-31 replaces the placeholder inputs and
            adds field-level validation + a Server Action for the submit. */}
        <section
          aria-label="Request form"
          className="rounded-3xl border bg-card p-6 sm:p-8 shadow-sm space-y-5"
        >
          {/* HVA-31: replace Field 1 / Field 2 / Field 3 with the real schema
              (customer name, phone, address, etc.). Inputs already at M3
              outlined / 12dp via the rounded-input token in app/globals.css —
              no per-input override needed. */}
          <div className="space-y-2">
            <Label htmlFor="field1" className="text-sm font-medium">
              Field 1
            </Label>
            <Input
              id="field1"
              placeholder="Placeholder copy — HVA-31"
              className="h-12"
              disabled
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="field2" className="text-sm font-medium">
              Field 2
            </Label>
            <Input
              id="field2"
              placeholder="Placeholder copy — HVA-31"
              className="h-12"
              disabled
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="field3" className="text-sm font-medium">
              Field 3
            </Label>
            <Input
              id="field3"
              placeholder="Placeholder copy — HVA-31"
              className="h-12"
              disabled
            />
          </div>

          {/* Submit button — Filled primary, 56dp mobile / 48dp desktop, full
              width. Currently a no-op toast trigger (see submit-button.tsx);
              HVA-31 swaps in the real Server Action invocation. */}
          <RequestSubmitButton />
        </section>
      </div>
    </main>
  );
}
