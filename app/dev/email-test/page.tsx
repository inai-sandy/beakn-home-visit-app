import { notFound } from 'next/navigation';

import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { sendEmail } from '@/lib/email';
import { customerTrackingLink } from '@/lib/email-templates';

// =============================================================================
// HVA-40: /dev/email-test — operator-driven SMTP smoke test
// =============================================================================
//
// GET /dev/email-test?to=someone@example.com
//
// Triggers a real SMTP send using the customer-tracking-link template with
// throwaway dummy data, and renders the {ok, messageId|error} on the page.
// This is the only verification surface in HVA-40 — actual consumers
// (HVA-42 customer confirmation, HVA-47 captain ping, status updates) are
// not wired yet.
//
// GATES (defense in depth — proxy.ts already enforces the first two):
//   1. NODE_ENV !== 'production' OR DEV_ROUTES_ENABLED === 'true'
//   2. super_admin session
//   Either gate failing → notFound() so the route's existence stays hidden.
//
// Don't send to a real customer inbox. Pass a Sandeep-owned address or a
// mailtrap-style sink.
//
// Re-rendering this page triggers another send. Rate limits apply (Hostinger
// shared SMTP caps at ~100 emails/hour) — burn that budget responsibly.
// =============================================================================

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ to?: string | string[] }>;
}

function isAllowed(role: string | undefined): boolean {
  if (role !== USER_ROLES.SUPER_ADMIN) return false;
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) return true;
  return process.env.DEV_ROUTES_ENABLED === 'true';
}

export default async function EmailTestPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (!session || !isAllowed(role)) {
    notFound();
  }

  const params = await searchParams;
  const rawTo = params.to;
  const to = Array.isArray(rawTo) ? rawTo[0] : rawTo;

  if (!to) {
    return (
      <main className="p-8 font-mono text-xs space-y-4">
        <h1 className="text-lg font-semibold">Email smoke test</h1>
        <p className="text-muted-foreground">
          Append <code>?to=address@example.com</code> to trigger a real SMTP
          send using the customer-tracking-link template.
        </p>
        <p className="text-muted-foreground">
          Don&apos;t send to real customer inboxes.
        </p>
      </main>
    );
  }

  // Basic sanity on the recipient. Anything that misses an @ won't even
  // make it past nodemailer; reject upfront so the page renders cleanly.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return (
      <main className="p-8 font-mono text-xs space-y-4">
        <h1 className="text-lg font-semibold">Email smoke test</h1>
        <pre className="bg-red-50 border border-red-200 p-3 rounded">
          {JSON.stringify({ ok: false, error: 'Invalid recipient address' }, null, 2)}
        </pre>
      </main>
    );
  }

  const rendered = customerTrackingLink({
    customerName: 'Verification User',
    trackingUrl: 'https://visits.beakn.in/track/SMOKE-TEST-ONLY',
    city: 'Bangalore',
  });

  const result = await sendEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    templateName: 'customer-tracking-link',
  });

  return (
    <main className="p-8 font-mono text-xs space-y-4">
      <h1 className="text-lg font-semibold">Email smoke test</h1>
      <div className="text-muted-foreground space-y-1">
        <div>Template: customer-tracking-link</div>
        <div>Subject: {rendered.subject}</div>
        <div>To: {to}</div>
        <div>From: {process.env.SMTP_FROM_NAME ?? 'Beakn'} &lt;{process.env.SMTP_FROM ?? 'visits@beakn.in'}&gt;</div>
      </div>
      <pre
        className={
          result.ok
            ? 'bg-emerald-50 border border-emerald-200 p-3 rounded'
            : 'bg-red-50 border border-red-200 p-3 rounded'
        }
      >
        {JSON.stringify(result, null, 2)}
      </pre>
      <p className="text-muted-foreground">
        Refresh the page to send again. Each render is a real SMTP send —
        keep an eye on rate limits.
      </p>
    </main>
  );
}
