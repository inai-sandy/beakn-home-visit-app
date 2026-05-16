import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { cities, users } from '@/db/schema';
import { sendEmail } from '@/lib/email';
import { captainNewRequest, type RoutingFlavor } from '@/lib/email-templates';
import { on, type AppEvents } from '@/lib/events';
import { log } from '@/lib/logger';

// =============================================================================
// HVA-42: route a `request.submitted` event to the right inbox
// =============================================================================
//
// Routing rules (locked this session, may differ from Linear body):
//
//   1. City has cities.captain_routing_email populated
//      → To: that email. Subject: "New Home Visit Request — {Name}, {City}".
//
//   2. City.name === 'Other'
//      → To: SMTP_FROM (visits@beakn.in)
//        Bcc: every active super_admin's users.email (skip nulls).
//        Subject: "New Home Visit Request — {Name} (Other City: {City})".
//
//   3. City exists but captain_routing_email is NULL/blank, OR the
//      captain_user_id is set to an inactive user, OR there's no captain
//      assigned at all
//      → To: SMTP_FROM
//        Bcc: every active super_admin's users.email.
//        Subject: "[UNROUTED — {City}] New Home Visit Request — {Name}".
//
// We use cities.captain_routing_email (not users.email of the linked
// captain) as the routing target because the columns are independent —
// HVA-90 designed them that way so a captain can authenticate with one
// email and receive routing to another (shared inbox, distribution list).
// If captain_routing_email is empty we treat it as "not routable yet,"
// not "fall back to users.email." That keeps the rule simple and the
// admin's intent explicit.
//
// CTA URL: /captain/requests/unassigned exists today (HVA-81). The
// per-request /captain/requests/[id] route is not built yet — when it
// lands, swap this URL. Pointing at the unassigned queue is the safest
// fallback because it shows the new request to whoever opens the email
// (provided they're a captain or super_admin).
//
// FIRE-AND-FORGET: this handler is invoked via emit('request.submitted')
// which schedules via setImmediate. Anything that goes wrong here MUST
// NOT bubble up — events.ts catches but we also defend per-section.
//
// RATE LIMIT (deferred to HVA-48): Hostinger shared SMTP caps at ~100/hr.
// A submission storm before HVA-48 ships will silently drop emails (or
// hit Hostinger's "Too many connections" reject). When HVA-48 lands,
// this handler should publish onto its queue instead of calling
// sendEmail directly.
//
// SELF-REGISTRATION: importing this module subscribes the handler. To
// guarantee the import happens before any /api/customer-request hit,
// `app/api/customer-request/route.ts` imports lib/notifications side-
// effects at module top.
// =============================================================================

const handlerLog = log.child({ component: 'notifications.captain-new-request' });

/** Redact a phone number to first-3 + last-2 digits. '+919876543210' → '+91987**10'. */
function redactPhone(phone: string): string {
  if (phone.length <= 5) return '***';
  return `${phone.slice(0, 5)}**${phone.slice(-2)}`;
}

/** Redact a recipient to first-char + domain. 'alice@example.com' → 'a***@example.com'. */
function redactRecipient(to: string): string {
  const at = to.indexOf('@');
  if (at <= 0) return '***';
  return `${to[0] ?? '*'}***${to.slice(at)}`;
}

const IST_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatIst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${IST_FORMATTER.format(d)} IST`;
}

function buildRequestUrl(): string {
  // CTA target. /captain/requests/[id] doesn't exist yet — use the
  // unassigned queue (HVA-81) as the closest meaningful landing. Both
  // captains and super_admins can reach it; the proxy lets super_admin
  // through every role-prefixed area.
  const origin = process.env.BETTER_AUTH_URL ?? 'https://visits.beakn.in';
  return `${origin.replace(/\/+$/, '')}/captain/requests/unassigned`;
}

interface ResolvedRoute {
  flavor: RoutingFlavor;
  to: string;
  bcc: string[];
  recipientLabel: string;
}

async function resolveRoute(
  cityId: string,
  cityName: string,
): Promise<ResolvedRoute | null> {
  const [city] = await db
    .select({
      id: cities.id,
      name: cities.name,
      captainRoutingEmail: cities.captainRoutingEmail,
      captainUserId: cities.captainUserId,
    })
    .from(cities)
    .where(eq(cities.id, cityId))
    .limit(1);

  if (!city) {
    handlerLog.error({ cityId, cityName }, 'captain_route_city_not_found');
    return null;
  }

  // Path 2: explicit "Other" city. Always escalate to super_admins.
  if (city.name === 'Other') {
    const bcc = await loadActiveSuperAdminEmails();
    return {
      flavor: 'other',
      to: process.env.SMTP_FROM ?? 'visits@beakn.in',
      bcc,
      recipientLabel: 'Beakn admin',
    };
  }

  // Path 1: city has an explicit routing email. Use it. We don't double-
  // check the captain's active status here — admins curate this column
  // directly, and a deactivated captain who left their inbox monitored
  // may still be the right routing target until the column is updated.
  if (city.captainRoutingEmail && city.captainRoutingEmail.trim().length > 0) {
    return {
      flavor: 'captain',
      to: city.captainRoutingEmail.trim(),
      bcc: [],
      recipientLabel: 'Captain',
    };
  }

  // Path 3: city has no routing email — unrouted. Surface to super_admins
  // with the [UNROUTED] subject prefix so it can't be confused with a
  // normal captain-bound email.
  const bcc = await loadActiveSuperAdminEmails();
  return {
    flavor: 'unrouted',
    to: process.env.SMTP_FROM ?? 'visits@beakn.in',
    bcc,
    recipientLabel: 'Beakn admin',
  };
}

async function loadActiveSuperAdminEmails(): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.role, 'super_admin'), eq(users.isActive, true)));
  return rows
    .map((r) => r.email?.trim())
    .filter((e): e is string => !!e && e.length > 0);
}

function summarizeInterest(raw: unknown): string {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
      .filter((s) => s.length > 0)
      .join(', ');
  }
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') return JSON.stringify(raw);
  return '';
}

async function handleRequestSubmitted(
  payload: AppEvents['request.submitted'],
): Promise<void> {
  const childLog = handlerLog.child({
    requestId: payload.requestId,
    city: payload.cityName,
    phone: redactPhone(payload.customerPhone),
  });

  const route = await resolveRoute(payload.cityId, payload.cityName);
  if (!route) return;

  childLog.info(
    {
      flavor: route.flavor,
      to: redactRecipient(route.to),
      bccCount: route.bcc.length,
    },
    'captain_route_resolved',
  );

  const rendered = captainNewRequest({
    flavor: route.flavor,
    recipientLabel: route.recipientLabel,
    customerName: payload.customerName,
    customerPhone: payload.customerPhone,
    customerEmail: payload.customerEmail,
    address: payload.address,
    city: payload.cityName,
    customerState: payload.customerState,
    bhk: payload.bhk,
    interestSummary: summarizeInterest(payload.interest),
    submittedAtIst: formatIst(payload.submittedAt),
    requestUrl: buildRequestUrl(),
  });

  const result = await sendEmail({
    to: route.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    bcc: route.bcc.length > 0 ? route.bcc : undefined,
    templateName: 'captain-new-request',
    requestId: payload.requestIdHeader,
  });

  if (!result.ok) {
    childLog.error(
      { flavor: route.flavor, error: result.error },
      'captain_route_send_failed',
    );
    return;
  }
  childLog.info(
    { flavor: route.flavor, messageId: result.messageId },
    'captain_route_send_ok',
  );
}

// Subscribe once at module load. Set semantics in lib/events.ts dedupe
// repeated registration if Next.js hot-reloads the module.
on('request.submitted', handleRequestSubmitted);
