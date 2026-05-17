import { and, asc, eq, gt } from "drizzle-orm";
import { formatDistanceToNow } from "date-fns";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { db } from "@/db/client";
import {
  cities,
  requestStatusHistory,
  statusStages,
  users,
  visitRequests,
} from "@/db/schema";
import { ROLE_HOME, isRole } from "@/lib/auth/roles";
import { getServerSession } from "@/lib/auth-server";
import { REJECTION_REASONS, type RejectionReason } from "@/lib/rejection-reasons";
import {
  computeActionVisibility,
  formatIstDateTime,
  terminalBadgeMeta,
  type TerminalActor,
} from "@/lib/request-detail";
import { cn } from "@/lib/utils";

import { AdvanceStatusButton } from "./advance-status-button";
import { CollectionSection } from "./collection-section";
import { CopyAddressButton } from "./copy-address-button";
import { MarkCustomerRejectedButton } from "./mark-customer-rejected-button";
import { MarkInstallationCompleteButton } from "./mark-installation-complete-button";

// =============================================================================
// HVA-66 (subsumes HVA-104): /requests/[id] — full request detail screen
// =============================================================================
//
// Shared route across all 3 staff roles. The proxy default-deny path
// bounces anonymous callers; authenticated callers reach the page and
// the page itself is the PRIVACY BOUNDARY for per-row visibility (brief
// explicitly flagged this).
//
// ROLE VISIBILITY:
//   - sales_executive: only if visit_requests.assigned_exec_user_id ===
//                      session.user.id  (else: redirect to /today?denied=1)
//   - captain:         only if visit_requests.city_id ∈ captain's owned
//                      cities (cities.captain_user_id = session.user.id)
//                      (else: redirect to /captain/dashboard?denied=1)
//   - super_admin:     always allow (HVA-99 escape hatch, intentional)
//   - anonymous:       proxy.ts handles before we get here
//
// LAYOUT (mobile-first, vertical scroll — explicit decision, no tabs):
//   0. Sticky top bar: 44×44 back button + customer name (HVA-66 extension)
//   1. Customer info card — name, tel/mailto (44px tap targets), address
//      w/ Copy + Open Maps, BHK, interest tags, IST submitted-at
//   2. Status timeline — synthetic "Submitted" + history rows + future
//      stages, with past/current/future styling
//   3. Terminal-state summary card (when cancelled_at set) — title varies
//      by cancellation_actor: 'customer' → "Customer cancelled" (HVA-39);
//      'exec'/'captain'/'admin' → "Customer rejected" (HVA-69).
//   4. Action buttons — visibility derived by lib/request-detail.ts
//      computeActionVisibility() so the rule is pure + unit-tested.
// =============================================================================

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Request — Beakn",
  robots: { index: false, follow: false },
};

const paramsSchema = z.object({
  id: z.string().uuid(),
});

interface PageProps {
  params: Promise<{ id: string }>;
}

function buildMapsUrl(
  latitude: string | null,
  longitude: string | null,
): string | null {
  // numeric columns deserialise as strings via drizzle/postgres-js. Open
  // Maps button only renders when both are present + parseable.
  if (!latitude || !longitude) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

const ROLE_HOME_DENIED: Record<string, string> = {
  sales_executive: "/today?denied=1",
  captain: "/captain/dashboard?denied=1",
};

export default async function RequestDetailPage({ params }: PageProps) {
  const paramsParsed = paramsSchema.safeParse(await params);
  if (!paramsParsed.success) notFound();
  const requestUuid = paramsParsed.data.id;

  // 1. Session gate (proxy.ts also enforces; defence-in-depth).
  const session = await getServerSession();
  if (!session) {
    redirect(`/login?next=/requests/${requestUuid}`);
  }
  const user = session.user as {
    id: string;
    role?: "sales_executive" | "captain" | "super_admin";
  };
  const role = user.role;

  // 2. Load the request. notFound() if absent — surfaces HTTP 404
  //    without leaking whether the id exists.
  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      customerEmail: visitRequests.customerEmail,
      address: visitRequests.address,
      customerState: visitRequests.customerState,
      cityId: visitRequests.cityId,
      cityName: cities.name,
      cityCaptainUserId: cities.captainUserId,
      cityState: cities.state,
      bhk: visitRequests.bhk,
      interest: visitRequests.interest,
      latitude: visitRequests.latitude,
      longitude: visitRequests.longitude,
      assignedExecUserId: visitRequests.assignedExecUserId,
      assignedCaptainUserId: visitRequests.assignedCaptainUserId,
      createdAt: visitRequests.createdAt,
      currentStageId: visitRequests.statusStageId,
      currentStageSeq: statusStages.sequenceNumber,
      currentStageName: statusStages.name,
      currentStageCode: statusStages.code,
      // HVA-69: terminal-state flag + rejection metadata for the
      // read-only summary card.
      cancelledAt: visitRequests.cancelledAt,
      cancellationActor: visitRequests.cancellationActor,
      cancellationReasonCode: visitRequests.cancellationReasonCode,
      cancellationReason: visitRequests.cancellationReason,
      cancelledByUserId: visitRequests.cancelledByUserId,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(eq(visitRequests.id, requestUuid))
    .limit(1);

  if (!reqRow) notFound();

  // 3. Per-role row-level visibility — the privacy boundary. The HVA-104
  // `canAdvance` flag was redundant with computeActionVisibility (HVA-66);
  // we just need the per-role redirect-or-allow decision here.
  if (role === "sales_executive" && reqRow.assignedExecUserId !== user.id) {
    redirect(ROLE_HOME_DENIED.sales_executive);
  }
  if (role === "captain" && reqRow.cityCaptainUserId !== user.id) {
    redirect(ROLE_HOME_DENIED.captain);
  }
  if (
    role !== "super_admin" &&
    role !== "sales_executive" &&
    role !== "captain"
  ) {
    redirect("/login");
  }

  // 4. Timeline history + future stages.
  const historyRows = await db
    .select({
      id: requestStatusHistory.id,
      toStageId: requestStatusHistory.toStatusStageId,
      toStageName: statusStages.name,
      sequenceNumber: requestStatusHistory.sequenceNumber,
      changedAt: requestStatusHistory.changedAt,
      reason: requestStatusHistory.reason,
      changedByUserId: requestStatusHistory.changedByUserId,
      changedByName: users.fullName,
    })
    .from(requestStatusHistory)
    .innerJoin(
      statusStages,
      eq(statusStages.id, requestStatusHistory.toStatusStageId),
    )
    .leftJoin(users, eq(users.id, requestStatusHistory.changedByUserId))
    .where(eq(requestStatusHistory.requestId, requestUuid))
    .orderBy(asc(requestStatusHistory.sequenceNumber));

  const futureStages = await db
    .select({
      id: statusStages.id,
      name: statusStages.name,
      sequenceNumber: statusStages.sequenceNumber,
    })
    .from(statusStages)
    .where(
      and(
        eq(statusStages.isActive, true),
        gt(statusStages.sequenceNumber, reqRow.currentStageSeq),
      ),
    )
    .orderBy(asc(statusStages.sequenceNumber));

  const isTerminal = futureStages.length === 0;
  const nextStage = futureStages[0] ?? null;
  const mapsUrl = buildMapsUrl(reqRow.latitude, reqRow.longitude);
  const interest = Array.isArray(reqRow.interest) ? reqRow.interest : [];

  // HVA-66: derive UI state via pure helpers in lib/request-detail.ts so the
  // visibility matrix is unit-testable without React Testing Library.
  const actionVis = computeActionVisibility({
    role: isRole(role) ? role : undefined,
    userId: user.id,
    currentStageCode: reqRow.currentStageCode,
    assignedExecUserId: reqRow.assignedExecUserId,
    cityCaptainUserId: reqRow.cityCaptainUserId,
    cancelledAt: reqRow.cancelledAt,
    hasNextStage: !!nextStage,
  });
  const backHref = isRole(role) ? ROLE_HOME[role] : "/";
  const submittedIst = formatIstDateTime(reqRow.createdAt);
  const cancelledIst = formatIstDateTime(reqRow.cancelledAt);
  const terminalMeta = reqRow.cancelledAt
    ? terminalBadgeMeta(reqRow.cancellationActor as TerminalActor)
    : null;

  return (
    <main className="min-h-svh bg-background">
      {/* HVA-66 sticky header: 44×44 back button + customer name so context
          survives long scrolls. Doesn't reflow the card stack below. */}
      <header className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b">
        <div className="mx-auto max-w-2xl px-4 sm:px-6 h-14 flex items-center gap-3">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0"
          >
            <Link
              href={backHref}
              aria-label="Back"
            >
              <Icon name="arrow_back" size="sm" />
            </Link>
          </Button>
          <p className="text-base font-semibold tracking-tight truncate flex-1">
            {reqRow.customerName}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-6">
        <section
          aria-label="Customer details"
          className="rounded-3xl border bg-card p-6 shadow-sm space-y-5"
        >
          <header className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold tracking-tight">
                {reqRow.customerName}
              </h1>
              {/* HVA-142: when cancelled, the destructive badge is the
                  primary signal; the underlying stage name moves to an
                  outline secondary badge so the historical context isn't
                  lost. Cancellation doesn't move status_stage_id by
                  design (HVA-69), so without this branch the captain
                  saw "Assigned" with no visible cancellation cue. */}
              {reqRow.cancelledAt !== null ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="destructive" className="text-[10px]">
                    Cancelled
                  </Badge>
                  <Badge
                    variant="outline"
                    className="text-[10px] text-muted-foreground"
                  >
                    was {reqRow.currentStageName}
                  </Badge>
                </div>
              ) : (
                <Badge variant="secondary" className="text-[10px]">
                  {reqRow.currentStageName}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="text-[10px]">
                {reqRow.cityName}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {reqRow.bhk}
              </Badge>
              {interest.map((it) => (
                <Badge key={it} variant="outline" className="text-[10px]">
                  {it}
                </Badge>
              ))}
            </div>
          </header>

          {/*
            HVA-66 tap targets: phone/email become block-level h-11 affordances
            so they meet the 44×44 iOS HIG minimum on mobile. Inline text
            links don't and were the main accessibility gap of the HVA-104 MVP.
          */}
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Phone
              </p>
              <Button asChild variant="outline" className="h-11 w-full justify-start font-mono text-primary">
                <a href={`tel:${reqRow.customerPhone}`} aria-label="Call customer">
                  <Icon name="phone" size="sm" />
                  <span>{reqRow.customerPhone}</span>
                </a>
              </Button>
            </div>
            {reqRow.customerEmail && (
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Email
                </p>
                <Button asChild variant="outline" className="h-11 w-full justify-start text-primary">
                  <a
                    href={`mailto:${reqRow.customerEmail}`}
                    aria-label="Email customer"
                  >
                    <Icon name="mail" size="sm" />
                    <span className="truncate">{reqRow.customerEmail}</span>
                  </a>
                </Button>
              </div>
            )}
          </div>

          {submittedIst && (
            <p className="text-xs text-muted-foreground">
              <Icon name="schedule" size="xs" className="inline align-text-bottom mr-1" />
              Submitted {submittedIst}
            </p>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Address
              </p>
              <CopyAddressButton address={reqRow.address} />
            </div>
            <p className="text-sm whitespace-pre-line">{reqRow.address}</p>
            {(reqRow.customerState || reqRow.cityState) && (
              <p className="text-xs text-muted-foreground">
                {[reqRow.cityName, reqRow.customerState ?? reqRow.cityState]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            )}
            {mapsUrl && (
              <Button asChild variant="outline" size="sm" className="mt-2">
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${reqRow.customerName}'s address in Google Maps`}
                >
                  <Icon name="map" size="xs" />
                  <span>Open in Maps</span>
                </a>
              </Button>
            )}
          </div>
        </section>

        <section
          aria-label="Status timeline"
          className="rounded-3xl border bg-card p-6 shadow-sm space-y-4"
        >
          <header className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">
              Status timeline
            </h2>
            {isTerminal && (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
                <Icon name="check_circle" size="sm" fill />
                <span>Completed</span>
              </span>
            )}
          </header>

          <ol className="space-y-3">
            <TimelineRow
              stageName="Submitted"
              when={reqRow.createdAt}
              changedByName="Customer"
              reason={null}
              variant={reqRow.currentStageSeq === 1 ? "current" : "past"}
            />

            {historyRows.map((h) => {
              const isCurrent = h.sequenceNumber === reqRow.currentStageSeq;
              return (
                <TimelineRow
                  key={h.id}
                  stageName={h.toStageName}
                  when={h.changedAt}
                  changedByName={h.changedByName ?? "System"}
                  reason={h.reason}
                  variant={isCurrent ? "current" : "past"}
                />
              );
            })}

            {futureStages.map((s) => (
              <TimelineRow
                key={s.id}
                stageName={s.name}
                when={null}
                changedByName={null}
                reason={null}
                variant="future"
              />
            ))}
          </ol>
        </section>

        <CollectionSection
          requestId={reqRow.id}
          role={isRole(role) ? role : undefined}
          userId={user.id}
          assignedExecUserId={reqRow.assignedExecUserId}
          cityCaptainUserId={reqRow.cityCaptainUserId}
          cancelledAt={reqRow.cancelledAt}
        />

        {reqRow.cancelledAt && terminalMeta && (
          <section className="rounded-3xl border border-destructive/30 bg-destructive/5 p-5 shadow-sm space-y-2">
            <div className="flex items-center gap-2">
              <Icon name="cancel" size="sm" className="text-destructive" />
              <h2 className="text-base font-semibold tracking-tight text-destructive">
                {terminalMeta.title}
              </h2>
            </div>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Reason</dt>
              <dd>
                {reqRow.cancellationReasonCode
                  ? REJECTION_REASONS[
                      reqRow.cancellationReasonCode as RejectionReason
                    ] ?? reqRow.cancellationReasonCode
                  : "—"}
              </dd>
              {reqRow.cancellationReason && (
                <>
                  <dt className="text-muted-foreground">Note</dt>
                  <dd className="whitespace-pre-wrap">{reqRow.cancellationReason}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Marked by</dt>
              <dd>{terminalMeta.markedByLabel}</dd>
              <dt className="text-muted-foreground">When</dt>
              <dd>{cancelledIst ?? "—"}</dd>
            </dl>
          </section>
        )}

        {/* HVA-66: action button visibility derived by lib/request-detail.ts
            computeActionVisibility. The pure helper makes the role × stage
            matrix unit-testable; render here only when any button is shown
            (otherwise the section + its margin would leave a stray gap). */}
        {nextStage &&
          (actionVis.showMarkRejected ||
            actionVis.showMarkComplete ||
            actionVis.showAdvance) && (
            <section className="flex justify-end gap-3 flex-wrap">
              {actionVis.showMarkRejected && (
                <MarkCustomerRejectedButton requestId={reqRow.id} />
              )}
              {actionVis.showMarkComplete && (
                <MarkInstallationCompleteButton requestId={reqRow.id} />
              )}
              {actionVis.showAdvance && (
                <AdvanceStatusButton
                  requestId={reqRow.id}
                  nextStatus={{ id: nextStage.id, name: nextStage.name }}
                />
              )}
            </section>
          )}
      </div>
    </main>
  );
}

interface TimelineRowProps {
  stageName: string;
  when: Date | null;
  changedByName: string | null;
  reason: string | null;
  variant: "past" | "current" | "future";
}

function TimelineRow({
  stageName,
  when,
  changedByName,
  reason,
  variant,
}: TimelineRowProps) {
  // HVA-66: timeline timestamps in IST too (was UTC-ish via raw format()).
  const absolute = when ? formatIstDateTime(when) : null;
  const relative = when
    ? formatDistanceToNow(when, { addSuffix: true })
    : null;

  return (
    <li
      className={cn(
        "rounded-2xl border-l-4 pl-4 pr-3 py-3 transition-colors",
        variant === "current" && "border-l-primary bg-primary/5",
        variant === "past" && "border-l-primary/40",
        variant === "future" && "border-l-muted text-muted-foreground/70",
      )}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <p
          className={cn(
            "text-sm font-semibold tracking-tight",
            variant === "future" && "font-medium",
          )}
        >
          {stageName}
        </p>
        {variant === "current" && (
          <Badge className="text-[10px]">Current</Badge>
        )}
        {variant === "future" && (
          <span className="text-[10px] uppercase tracking-wide">Pending</span>
        )}
      </div>
      {absolute && (
        <p className="text-xs text-muted-foreground mt-1">
          <span className="font-mono">{absolute}</span>
          <span className="mx-1">·</span>
          <span>{relative}</span>
          {changedByName && (
            <>
              <span className="mx-1">·</span>
              <span>{changedByName}</span>
            </>
          )}
        </p>
      )}
      {reason && (
        <p className="text-xs text-foreground/80 mt-1.5 whitespace-pre-line">
          {reason}
        </p>
      )}
    </li>
  );
}
