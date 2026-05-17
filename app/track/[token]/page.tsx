import { asc, eq, gt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { formatDistanceToNow } from "date-fns";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { Icon } from "@/components/ui/icon";
import { db } from "@/db/client";
import {
  requestExecAssignments,
  requestStatusHistory,
  statusStages,
  users,
  visitRequests,
} from "@/db/schema";
import { getCustomerFacingReason } from "@/lib/cancellation-reasons";
import { getConfig } from "@/lib/config";
import { log } from "@/lib/logger";
import { cn } from "@/lib/utils";

// =============================================================================
// HVA-36: /track/[token] — public customer tracking page (premium)
// =============================================================================
//
// Token-based read-only view of a customer's visit request. NO auth, NO
// session check — the URL token IS the credential (nanoid(21), unguessable
// per HVA-33). /track/ is in proxy.ts PUBLIC_PAGE_PREFIXES.
//
// DEVIATIONS from the original HVA-36 body (applied per brief):
//   - Schema: uses status_stage_id (FK) + join, not a 'status' column
//   - Documents section: dropped (HVA-37 unbuilt, no documents table)
//   - Settings icon: dropped (no meaningful settings for an unauth'd
//     customer)
//   - Polling: dropped (page works without JS; customer reloads to see
//     status changes)
//   - Customer support phone: read from config service
//     (getConfig('customer_support_phone')); fall back to placeholder if
//     empty + flagged in the deploy summary so we remember to seed
//
// PREMIUM design defined concretely (no gradients, no glass effects, no
// framer-motion):
//   - max-w-2xl + px-6 md:px-12, gap-8 between sections
//   - Type scale 1.2-1.4× internal portal: text-3xl/4xl hero,
//     text-xl body, text-sm timeline metadata
//   - Solid background, large rounded-3xl status centerpiece
// =============================================================================

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

export const metadata: Metadata = {
  title: "Track your request — Beakn",
  description: "Follow the progress of your home visit.",
  robots: { index: false, follow: false },
};

// One-line copy per stage. Kept INLINE (no `description` column on
// status_stages) — adding a DB column for 10 strings is overkill, and
// admin renames of stage names are rare. If we ever localise these,
// promote to a translation map then.
const STAGE_DESCRIPTIONS: Record<string, string> = {
  SUBMITTED:
    "We've received your request. Our team will reach out within 24 hours.",
  ASSIGNED:
    "A captain has assigned this to a team member who'll contact you shortly.",
  VISIT_SCHEDULED: "Your home visit is on the calendar.",
  VISIT_COMPLETED:
    "Our team has visited your home and gathered the details.",
  QUOTATION_GIVEN: "We've shared a tailored quotation with you.",
  ORDER_CONFIRMED:
    "Thanks for the order — we're preparing your installation.",
  INSTALLATION_SCHEDULED: "Installation is on the calendar.",
  INSTALLATION_CONFIGURATION_DONE:
    "Devices are installed and configured. Final approval pending.",
  PENDING_CAPTAIN_APPROVAL: "Our captain is reviewing the installation.",
  ORDER_EXECUTED_SUCCESSFULLY: "All done. Welcome to your smart home!",
};

// Placeholder if customer_support_phone isn't seeded. Render-time fall-
// back; surfaced in the deploy summary so this gets a real value later.
// TODO: seed customer_support_phone in config when Beakn lands a real
// support number.
const SUPPORT_PHONE_PLACEHOLDER = "+91 80000 00000";

function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  const space = trimmed.indexOf(" ");
  return space === -1 ? trimmed : trimmed.slice(0, space);
}

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

export default async function TrackPage({ params }: PageProps) {
  const { token } = await params;

  // 1. Lookup by tracking_token. Cheap (UNIQUE indexed). 404 on miss.
  //    HVA-142: cancelledAt + cancellationReasonCode pulled so the page
  //    can swap the Current Status centerpiece + Timeline tail when the
  //    request has been closed.
  const [reqRow] = await db
    .select({
      customerName: visitRequests.customerName,
      createdAt: visitRequests.createdAt,
      currentStageId: visitRequests.statusStageId,
      currentStageCode: statusStages.code,
      currentStageName: statusStages.name,
      currentStageSeq: statusStages.sequenceNumber,
      cancelledAt: visitRequests.cancelledAt,
      cancellationReasonCode: visitRequests.cancellationReasonCode,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(eq(visitRequests.trackingToken, token))
    .limit(1);

  if (!reqRow) notFound();

  const isCancelled = reqRow.cancelledAt !== null;
  const customerFacingReason = getCustomerFacingReason(
    reqRow.cancellationReasonCode,
  );

  // 2. Timeline history (transitions only — HVA-67 doesn't record the
  //    initial Submitted stage). Joined back to visit_requests by
  //    tracking_token so we don't have to round-trip via the
  //    visit_requests row's id.
  //
  // HVA-141: also pull the from-stage's seq so the renderer can detect a
  // rollback row (to_seq < from_seq) and label it "Moved back to …".
  // Order by transition_order (the new monotonic per-request counter
  // from migration 0013) so a rollback row sits chronologically after
  // the forward row it undid, not interleaved by stage seq.
  const fromStage = alias(statusStages, 'from_stage');
  const toStage = alias(statusStages, 'to_stage');
  const cleanHistoryRows = await db
    .select({
      id: requestStatusHistory.id,
      toStageCode: toStage.code,
      toStageName: toStage.name,
      toStageSeq: toStage.sequenceNumber,
      fromStageSeq: fromStage.sequenceNumber,
      sequenceNumber: requestStatusHistory.sequenceNumber,
      changedAt: requestStatusHistory.changedAt,
    })
    .from(requestStatusHistory)
    .innerJoin(visitRequests, eq(visitRequests.id, requestStatusHistory.requestId))
    .innerJoin(toStage, eq(toStage.id, requestStatusHistory.toStatusStageId))
    .leftJoin(fromStage, eq(fromStage.id, requestStatusHistory.fromStatusStageId))
    .where(eq(visitRequests.trackingToken, token))
    .orderBy(asc(requestStatusHistory.transitionOrder));

  // HVA-140: reassignment events live in their own table because they
  // do NOT change status_stage_id. Fetch them in the customer's
  // chronological order (oldest first); the renderer below merges them
  // with cleanHistoryRows into a single timeline. We only surface the
  // NEW exec's name to the customer — captain's reason + previous exec
  // stay internal (audit_log + in-app notifications).
  const reassignRows = await db
    .select({
      id: requestExecAssignments.id,
      newExecName: users.fullName,
      createdAt: requestExecAssignments.createdAt,
    })
    .from(requestExecAssignments)
    .innerJoin(
      visitRequests,
      eq(visitRequests.id, requestExecAssignments.requestId),
    )
    .innerJoin(users, eq(users.id, requestExecAssignments.toExecUserId))
    .where(eq(visitRequests.trackingToken, token))
    .orderBy(asc(requestExecAssignments.createdAt));

  // Merge into a single chronological timeline. Each entry carries
  // enough discriminator info for the renderer to pick a variant +
  // label without re-querying.
  type TimelineEntry =
    | {
        kind: 'history';
        id: string;
        when: Date;
        stageName: string;
        isRollback: boolean;
        isCurrent: boolean;
      }
    | {
        kind: 'reassign';
        id: string;
        when: Date;
        newExecName: string;
      };

  const timelineEntries: TimelineEntry[] = [
    ...cleanHistoryRows.map<TimelineEntry>((h) => ({
      kind: 'history',
      id: h.id,
      when: h.changedAt,
      stageName: h.toStageName,
      isRollback: h.fromStageSeq !== null && h.toStageSeq < h.fromStageSeq,
      isCurrent: h.sequenceNumber === reqRow.currentStageSeq,
    })),
    ...reassignRows.map<TimelineEntry>((r) => ({
      kind: 'reassign',
      id: r.id,
      when: r.createdAt,
      newExecName: r.newExecName ?? 'a new sales executive',
    })),
  ].sort((a, b) => a.when.getTime() - b.when.getTime());

  const futureStages = await db
    .select({
      id: statusStages.id,
      code: statusStages.code,
      name: statusStages.name,
      sequenceNumber: statusStages.sequenceNumber,
    })
    .from(statusStages)
    .where(gt(statusStages.sequenceNumber, reqRow.currentStageSeq))
    .orderBy(asc(statusStages.sequenceNumber));

  // 3. Customer support phone from config. Empty → placeholder + log.
  let supportPhoneRaw: string;
  try {
    supportPhoneRaw =
      (await getConfig("customer_support_phone")) ?? "";
  } catch {
    supportPhoneRaw = "";
  }
  let supportPhoneIsPlaceholder = false;
  if (!supportPhoneRaw.trim()) {
    supportPhoneRaw = SUPPORT_PHONE_PLACEHOLDER;
    supportPhoneIsPlaceholder = true;
    log
      .child({ component: "track" })
      .info(
        { trackingToken: token },
        "customer_support_phone_unset_using_placeholder",
      );
  }
  const supportPhoneDigits = digitsOnly(supportPhoneRaw);
  const waLink = supportPhoneDigits
    ? `https://wa.me/${supportPhoneDigits}`
    : null;

  const isTerminal = futureStages.length === 0;
  const currentStageDescription =
    STAGE_DESCRIPTIONS[reqRow.currentStageCode] ?? "";

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-2xl px-6 md:px-12 py-8 md:py-12 space-y-8">
        {/* Header — logo only (no settings icon per brief deviation) */}
        <header className="flex items-center">
          <Image
            src="/icon-512x512.png"
            alt="Beakn"
            width={48}
            height={48}
            priority
            className="rounded-xl"
          />
        </header>

        {/* Hero */}
        <section className="space-y-2">
          <h1 className="text-3xl md:text-4xl font-medium tracking-tight">
            Hi {firstName(reqRow.customerName)},
          </h1>
          <p className="text-xl text-muted-foreground">
            Your home automation journey is underway.
          </p>
        </section>

        {/* Status centerpiece.
            HVA-142: when the request is cancelled, the centerpiece flips
            to a destructive variant that names the closure plainly +
            shows a customer-safe reason (only if the recorded code is
            on the whitelist in lib/cancellation-reasons.ts). Exec-only
            reasons like "Price too high" fall through to no reason line,
            so we don't echo internal pricing context back at the
            customer. */}
        {isCancelled ? (
          <section
            aria-label="Current status"
            className="rounded-3xl p-8 md:p-10 text-center space-y-3 border border-destructive/30 bg-destructive/5"
          >
            <div className="flex justify-center">
              <Icon
                name="cancel"
                fill
                className="text-destructive"
                style={{ fontSize: "48px" }}
              />
            </div>
            <p className="text-xs uppercase tracking-wide text-destructive/80">
              Closed
            </p>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-destructive">
              Request Cancelled
            </h2>
            <p className="text-sm md:text-base text-muted-foreground max-w-prose mx-auto">
              Your request has been closed.
            </p>
            {customerFacingReason && (
              <p className="text-sm md:text-base text-muted-foreground max-w-prose mx-auto">
                Reason: {customerFacingReason}
              </p>
            )}
          </section>
        ) : (
          <section
            aria-label="Current status"
            className={cn(
              "rounded-3xl p-8 md:p-10 text-center space-y-3 border",
              isTerminal
                ? "border-primary/30 bg-primary/10"
                : "border-primary/20 bg-primary/5",
            )}
          >
            {isTerminal && (
              <div className="flex justify-center">
                <Icon
                  name="check_circle"
                  fill
                  className="text-primary"
                  style={{ fontSize: "48px" }}
                />
              </div>
            )}
            <p className="text-xs uppercase tracking-wide text-primary/80">
              {isTerminal ? "Completed" : "Current status"}
            </p>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
              {reqRow.currentStageName}
            </h2>
            {currentStageDescription && (
              <p className="text-sm md:text-base text-muted-foreground max-w-prose mx-auto">
                {currentStageDescription}
              </p>
            )}
          </section>
        )}

        {/* Timeline — compact list with left vertical line + dots */}
        <section aria-label="Status timeline" className="space-y-4">
          <h3 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
            Timeline
          </h3>
          <ol className="relative pl-7">
            {/* Vertical connecting line */}
            <span
              aria-hidden="true"
              className="absolute left-[10px] top-2 bottom-2 w-px bg-border"
            />

            {/* Synthetic Submitted entry */}
            <TimelineDot
              stageName="Submitted"
              when={reqRow.createdAt}
              variant={reqRow.currentStageSeq === 1 ? "current" : "past"}
              isFirst
            />

            {/* HVA-141 + HVA-140: merged chronological timeline. History
                rows carry the rollback/current/past variants; reassign
                rows render as a generic "Now being handled by {name}"
                informational entry — customer-safe phrasing, NO mention
                of the previous exec or the captain's reason. */}
            {timelineEntries.map((entry) => {
              if (entry.kind === 'reassign') {
                return (
                  <TimelineDot
                    key={`reassign-${entry.id}`}
                    stageName={`Your visit is now being handled by ${entry.newExecName}`}
                    when={entry.when}
                    variant="reassign"
                  />
                );
              }
              return (
                <TimelineDot
                  key={entry.id}
                  stageName={
                    entry.isRollback
                      ? `Moved back to ${entry.stageName}`
                      : entry.stageName
                  }
                  when={entry.when}
                  variant={
                    entry.isRollback
                      ? "rollback"
                      : entry.isCurrent
                        ? "current"
                        : "past"
                  }
                />
              );
            })}

            {/* HVA-142: when cancelled, the timeline terminates at the
                cancellation entry — pending future stages would be
                misleading because the pipeline has stopped. */}
            {isCancelled ? (
              <TimelineDot
                stageName="Cancelled"
                when={reqRow.cancelledAt}
                variant="cancelled"
                reasonText={customerFacingReason}
              />
            ) : (
              futureStages.map((s) => (
                <TimelineDot
                  key={s.id}
                  stageName={s.name}
                  when={null}
                  variant="future"
                />
              ))
            )}
          </ol>
        </section>

        {/* Footer — WhatsApp support */}
        <footer className="pt-6 border-t text-center text-sm text-muted-foreground space-y-1">
          {waLink ? (
            <p>
              Questions?{" "}
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm inline-flex items-center gap-1"
              >
                <Icon name="chat" size="xs" />
                WhatsApp us at {supportPhoneRaw}
              </a>
            </p>
          ) : (
            <p>
              Questions? Support phone is being set up; please email us.
            </p>
          )}
          {supportPhoneIsPlaceholder && (
            // Visible but small notice — placeholder copy means the
            // admin hasn't seeded customer_support_phone yet. Renders
            // in muted text so it doesn't dominate the footer.
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Demo number — real support line coming soon.
            </p>
          )}
        </footer>
      </div>
    </main>
  );
}

interface TimelineDotProps {
  stageName: string;
  when: Date | null;
  variant:
    | "past"
    | "current"
    | "future"
    | "cancelled"
    | "rollback"
    | "reassign";
  isFirst?: boolean;
  /** HVA-142: shown only for the cancelled variant when a customer-safe
   * reason is available; null otherwise. */
  reasonText?: string | null;
}

function TimelineDot({
  stageName,
  when,
  variant,
  isFirst,
  reasonText,
}: TimelineDotProps) {
  const relative = when
    ? formatDistanceToNow(when, { addSuffix: true })
    : null;

  return (
    <li className={cn("relative", isFirst ? "" : "mt-5")}>
      {/* Dot */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute -left-7 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full border",
          variant === "current" && "bg-primary border-primary",
          variant === "past" && "bg-primary/70 border-primary/70",
          variant === "future" && "bg-background border-muted",
          variant === "cancelled" && "bg-destructive border-destructive",
          // HVA-141: rollback is a normal flow event but visually
          // distinct — outline with muted foreground so it doesn't
          // alarm the customer.
          variant === "rollback" &&
            "bg-background border-muted-foreground/40",
          // HVA-140: reassignment is informational. Same muted outline
          // treatment as rollback so the customer reads it as a
          // routine handoff, not an interruption.
          variant === "reassign" &&
            "bg-background border-muted-foreground/40",
        )}
      >
        {variant === "current" && (
          <span className="h-2 w-2 rounded-full bg-primary-foreground" />
        )}
        {variant === "cancelled" && (
          <span className="h-2 w-2 rounded-full bg-destructive-foreground" />
        )}
      </span>

      <div className="space-y-0.5">
        <p
          className={cn(
            "text-base",
            variant === "current" && "font-semibold text-foreground",
            variant === "past" && "font-medium text-foreground",
            variant === "future" && "text-muted-foreground",
            variant === "cancelled" && "font-semibold text-destructive",
            variant === "rollback" && "font-medium text-muted-foreground",
            variant === "reassign" && "font-medium text-muted-foreground",
          )}
        >
          {stageName}
        </p>
        {relative && (
          <p className="text-xs text-muted-foreground">{relative}</p>
        )}
        {variant === "cancelled" && reasonText && (
          <p className="text-xs text-muted-foreground">
            Reason: {reasonText}
          </p>
        )}
      </div>
    </li>
  );
}

