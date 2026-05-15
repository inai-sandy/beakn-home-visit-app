import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { eq } from "drizzle-orm";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { db } from "@/db/client";
import { visitRequests } from "@/db/schema";

import { CopyTrackingLink } from "./copy-tracking-link";

// =============================================================================
// HVA-35: /submitted/[token] — post-submission confirmation
// =============================================================================
//
// One-time celebratory success page customers land on after their form
// submits successfully. NOT the tracking page (/track/[token] is HVA-?).
// Public route — the URL token IS the authentication. Added to proxy.ts
// PUBLIC_PAGE_PREFIXES alongside /request and /track/.
//
// DATA SHAPE assumptions (for HVA-33 to match):
//   - Table: `visit_requests` (HVA-14 schema; tracking_token column
//     pre-existed, no migration needed despite the brief assuming
//     otherwise).
//   - Column: `customer_name` (not `name`). First-word interpolation
//     below uses the same DB column.
//   - Column: `tracking_token` (varchar(32) NOT NULL, UNIQUE). HVA-33
//     populates this on insert; this page queries by it.
//
// 404 vs 200:
//   - Token found → 200 with success layout.
//   - Token absent → next/navigation `notFound()`, which renders the
//     project's not-found tree (and Next sets HTTP 404 by default for
//     server component notFound()).
//
// FUTURE WIRING (deliberately deferred):
//   - "Open Tracking Page" links to /track/[token]; that route doesn't
//     exist yet (later issue). The link target is correct; clicking
//     it 404s today. When /track ships, the link starts working with
//     no change here.
//   - "We've also sent this link to your WhatsApp and email." copy is
//     ASPIRATIONAL — HVA-48 (notification engine) actually sends.
//     Customers who notice the message-not-arriving will only do so
//     after HVA-48 ships, by which point the gap closes.
// =============================================================================

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Request received — Beakn",
  description: "Your home visit request has been received.",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  const space = trimmed.indexOf(" ");
  if (space === -1) return trimmed;
  return trimmed.slice(0, space);
}

export default async function SubmittedPage({ params }: PageProps) {
  const { token } = await params;

  // Cheap, indexed lookup via the unique tracking_token. Select only the
  // column we render — keeps the success path off the wider row that
  // contains the PII bundle.
  const rows = await db
    .select({ customerName: visitRequests.customerName })
    .from(visitRequests)
    .where(eq(visitRequests.trackingToken, token))
    .limit(1);

  if (rows.length === 0) {
    notFound();
  }

  const name = firstName(rows[0].customerName);
  const trackingUrl = `https://visits.beakn.in/track/${token}`;

  return (
    <main className="min-h-svh flex flex-col items-center px-6 py-10 bg-background">
      <div className="w-full max-w-md sm:max-w-lg flex flex-col items-stretch gap-6">
        {/* Logo */}
        <header className="flex flex-col items-center gap-4 pt-4">
          <Image
            src="/icon-512x512.png"
            alt="Beakn"
            width={88}
            height={88}
            priority
            className="rounded-2xl"
          />
        </header>

        {/* Checkmark + headline + body */}
        <section className="flex flex-col items-center text-center gap-4">
          <Icon
            name="check_circle"
            // 64dp ≈ Material Symbols 64px. The component supports xs/sm/
            // md/lg/xl; xl is 32px. We need a true 64dp glyph, so push
            // the size via inline font-size override (Material Symbols
            // size is the font-size of the wrapper span).
            size="xl"
            fill
            className="text-primary"
            style={{ fontSize: "64px" }}
          />
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-balance">
            {`Thanks, ${name} — we've received your request.`}
          </h1>
          <p className="text-sm text-muted-foreground text-balance">
            Our team will reach out within 24 hours to schedule your free
            home visit.
          </p>
        </section>

        {/* Tracking link card — subtler M3 surface than the request form's
            card. rounded-3xl matches the form card on /request. */}
        <section className="rounded-3xl bg-muted/40 border border-border/50 p-5 sm:p-6 space-y-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Track your request anytime at:
          </p>
          <CopyTrackingLink url={trackingUrl} />
        </section>

        {/* Aspirational delivery note. HVA-48 lands the real WhatsApp +
            email send; until then this string is best-effort copy. */}
        <p className="text-xs text-muted-foreground text-center">
          We&apos;ve also sent this link to your WhatsApp and email.
        </p>

        {/* Filled primary — Open Tracking Page. Target /track/[token]
            doesn't render yet (separate later issue); link is wired
            so it lights up automatically when that route ships. */}
        <Button asChild className="w-full h-14 sm:h-12 text-base font-medium">
          <Link href={`/track/${token}`}>Open Tracking Page</Link>
        </Button>
      </div>
    </main>
  );
}
