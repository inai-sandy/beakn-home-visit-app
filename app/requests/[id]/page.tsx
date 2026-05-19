import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
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
  salesExecutives,
  statusStages,
  users,
  visitRequests,
} from "@/db/schema";
import { ROLE_HOME, isRole } from "@/lib/auth/roles";
import { getServerSession } from "@/lib/auth-server";
import { canExecEditRequest } from "@/lib/exec/edit-auth";
import { REJECTION_REASONS, type RejectionReason } from "@/lib/rejection-reasons";
import {
  computeActionVisibility,
  formatIstDateTime,
  terminalBadgeMeta,
  type TerminalActor,
} from "@/lib/request-detail";
import { cn } from "@/lib/utils";

import { AdvanceStatusButton } from "./advance-status-button";
import { ApproveRequestButton } from "./approve-request-button";
import { AssignRequestButton } from "./assign-request-button";
import { CollectionSection } from "./collection-section";
import { CopyAddressButton } from "./copy-address-button";
import { MarkCustomerRejectedButton } from "./mark-customer-rejected-button";
import { MarkInstallationCompleteButton } from "./mark-installation-complete-button";
import { ReassignRequestButton } from "./reassign-request-button";
import { RejectRequestButton } from "./reject-request-button";
import { RollbackStatusButton } from "./rollback-status-button";
import { EditRequestButton } from "./_components/EditRequestButton";

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
      // HVA-159: editable scheduling field.
      visitScheduledAt: visitRequests.visitScheduledAt,
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
  //    HVA-144: project + order by transition_order so a request that
  //    has been rolled back (and thus has multiple history rows with
  //    the same target stage seq) renders chronologically + can be
  //    uniquely tagged "current" on the latest row only. Pre-HVA-141
  //    requests have transition_order populated via the backfill in
  //    migration 0013.
  const historyRows = await db
    .select({
      id: requestStatusHistory.id,
      toStageId: requestStatusHistory.toStatusStageId,
      toStageName: statusStages.name,
      sequenceNumber: requestStatusHistory.sequenceNumber,
      transitionOrder: requestStatusHistory.transitionOrder,
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
    .orderBy(asc(requestStatusHistory.transitionOrder));

  // HVA-144: the "Current" badge belongs on exactly one history row —
  // the latest transition. Without this, two rows that share a target
  // stage seq (e.g. forward → rollback → forward-again, both landing
  // on VISIT_SCHEDULED) would both match `h.sequenceNumber === currentSeq`
  // and both render with the "Current" badge.
  const maxTransitionOrder =
    historyRows.length > 0
      ? historyRows[historyRows.length - 1].transitionOrder
      : 0;

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

  // HVA-141: previous active stage (highest seq < current). Powers the
  // Rollback button's "Go back to {previousStage.name}" label and the
  // hasPreviousStage flag fed to computeActionVisibility.
  const [previousStage] = await db
    .select({
      id: statusStages.id,
      name: statusStages.name,
      sequenceNumber: statusStages.sequenceNumber,
    })
    .from(statusStages)
    .where(
      and(
        eq(statusStages.isActive, true),
        lt(statusStages.sequenceNumber, reqRow.currentStageSeq),
      ),
    )
    .orderBy(desc(statusStages.sequenceNumber))
    .limit(1);

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
    hasPreviousStage: !!previousStage,
  });

  // HVA-139: when the Assign Sales Executive button will render, also
  // load the captain's exec list so the shared modal can populate its
  // picker. Scope:
  //   - captain → their own team (salesExecutives.captainUserId === user.id)
  //   - super_admin → execs reporting to the request's city captain;
  //     fall back to all active execs if the city has no captain assigned
  //     (uncommon — admin should fix the city row).
  // No query is run when showAssignExec is false.
  let execsForAssignment: Array<{ id: string; fullName: string }> = [];
  if (actionVis.showAssignExec) {
    const captainOwnerId =
      role === "super_admin"
        ? reqRow.cityCaptainUserId ?? user.id
        : user.id;
    execsForAssignment = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(salesExecutives)
      .innerJoin(users, eq(users.id, salesExecutives.userId))
      .where(
        and(
          eq(salesExecutives.captainUserId, captainOwnerId),
          eq(users.isActive, true),
        ),
      )
      .orderBy(asc(users.fullName));
  }

  // HVA-140: when the Reassign Exec button will render, fetch the
  // current exec's display name (for the modal's read-only header) and
  // the captain's team excluding the current exec (for the picker).
  // No query is run when showReassign is false.
  let currentExecForReassign: { id: string; fullName: string } | null = null;
  let reassignCandidates: Array<{ id: string; fullName: string }> = [];
  if (actionVis.showReassign && reqRow.assignedExecUserId) {
    const [u] = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, reqRow.assignedExecUserId))
      .limit(1);
    if (u) currentExecForReassign = u;

    const captainOwnerId =
      role === "super_admin"
        ? reqRow.cityCaptainUserId ?? user.id
        : user.id;
    const team = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(salesExecutives)
      .innerJoin(users, eq(users.id, salesExecutives.userId))
      .where(
        and(
          eq(salesExecutives.captainUserId, captainOwnerId),
          eq(users.isActive, true),
        ),
      )
      .orderBy(asc(users.fullName));
    reassignCandidates = team.filter((e) => e.id !== reqRow.assignedExecUserId);
  }

  // HVA-137: at PENDING_CAPTAIN_APPROVAL we render the captain's
  // Approve/Reject UI and (for the exec) a static "Waiting for
  // {captainName}" section that surfaces the exec's submitted note.
  // The note lives on the most recent request_status_history row
  // pointing INTO PENDING_CAPTAIN_APPROVAL — use transition_order to
  // pick the latest in case a request was rejected and re-advanced.
  let pendingApprovalNote: string | null = null;
  let cityCaptainName: string | null = null;
  if (reqRow.currentStageCode === "PENDING_CAPTAIN_APPROVAL") {
    const [latestIntoApproval] = await db
      .select({ reason: requestStatusHistory.reason })
      .from(requestStatusHistory)
      .innerJoin(
        statusStages,
        eq(statusStages.id, requestStatusHistory.toStatusStageId),
      )
      .where(
        and(
          eq(requestStatusHistory.requestId, requestUuid),
          eq(statusStages.code, "PENDING_CAPTAIN_APPROVAL"),
        ),
      )
      .orderBy(desc(requestStatusHistory.transitionOrder))
      .limit(1);
    pendingApprovalNote = latestIntoApproval?.reason ?? null;

    if (reqRow.cityCaptainUserId) {
      const [c] = await db
        .select({ fullName: users.fullName })
        .from(users)
        .where(eq(users.id, reqRow.cityCaptainUserId))
        .limit(1);
      cityCaptainName = c?.fullName ?? null;
    }
  }

  const backHref = isRole(role) ? ROLE_HOME[role] : "/";
  const submittedIst = formatIstDateTime(reqRow.createdAt);
  const cancelledIst = formatIstDateTime(reqRow.cancelledAt);
  const terminalMeta = reqRow.cancelledAt
    ? terminalBadgeMeta(reqRow.cancellationActor as TerminalActor)
    : null;

  // HVA-159: exec-side edit pencil. Captain edit ships in HVA-163 (out
  // of scope here), so captains see no pencil. super_admin keeps the
  // existing escape-hatch.
  const isExec = role === "sales_executive";
  const editable =
    role === "super_admin" ||
    (isExec && (await canExecEditRequest(user.id, reqRow.id)));
  const editCityRows = editable
    ? await db
        .select({ id: cities.id, name: cities.name })
        .from(cities)
        .where(eq(cities.isActive, true))
        .orderBy(asc(cities.name))
    : [];
  const editRequestPayload = editable
    ? {
        id: reqRow.id,
        customerName: reqRow.customerName,
        customerPhone: reqRow.customerPhone,
        customerEmail: reqRow.customerEmail,
        address: reqRow.address,
        cityId: reqRow.cityId,
        bhk: reqRow.bhk,
        customerState: reqRow.customerState,
        visitScheduledAt: reqRow.visitScheduledAt
          ? reqRow.visitScheduledAt.toISOString()
          : null,
      }
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
          {editable && editRequestPayload && (
            <EditRequestButton
              request={editRequestPayload}
              cities={editCityRows}
            />
          )}
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
            {/* HVA-144: the synthetic Submitted row is "current" only
                when there are NO history rows (i.e., the request is
                still at SUBMITTED). Without this guard, a request that
                has moved past Submitted but came back via some future
                rollback path landing at seq 1 would briefly double-tag.
                Today's pipeline forbids rolling back to SUBMITTED, so
                this is defence-in-depth. */}
            <TimelineRow
              stageName="Submitted"
              when={reqRow.createdAt}
              changedByName="Customer"
              reason={null}
              variant={historyRows.length === 0 ? "current" : "past"}
            />

            {historyRows.map((h) => {
              // HVA-144: only the last transition (max transition_order)
              // gets the "Current" badge — fixes the double-Current bug
              // after a rollback re-traverses a previously-visited stage.
              const isCurrent = h.transitionOrder === maxTransitionOrder;
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
        {/* HVA-137: exec-facing waiting section at PENDING_CAPTAIN_APPROVAL.
            Shows only to the assigned exec. The note here is what the
            exec submitted via Mark Installation Complete (HVA-68);
            captain name comes from the request's city. */}
        {reqRow.currentStageCode === "PENDING_CAPTAIN_APPROVAL" &&
          role === "sales_executive" &&
          reqRow.assignedExecUserId === user.id && (
            <section className="rounded-3xl border border-amber-500/30 bg-amber-500/5 p-5 shadow-sm space-y-2">
              <div className="flex items-center gap-2">
                <Icon name="hourglass_top" size="sm" className="text-amber-700" />
                <h2 className="text-base font-semibold tracking-tight text-amber-900">
                  Waiting for {cityCaptainName ?? "your captain"} to approve
                </h2>
              </div>
              {pendingApprovalNote ? (
                <div className="rounded-2xl bg-background/70 border px-4 py-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                    Your note
                  </p>
                  <p className="text-sm whitespace-pre-wrap">
                    {pendingApprovalNote}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No note was attached when you marked installation
                  complete.
                </p>
              )}
            </section>
          )}

        {nextStage &&
          (actionVis.showMarkRejected ||
            actionVis.showMarkComplete ||
            actionVis.showAdvance ||
            actionVis.showAssignExec ||
            actionVis.showRollback ||
            actionVis.showReassign ||
            actionVis.showApprove ||
            actionVis.showReject) && (
            <section className="flex justify-end gap-3 flex-wrap">
              {/* Outline / subordinate buttons first (rollback +
                  reassign + reject), then destructive Mark Rejected,
                  then the primary forward action (incl. Approve) on the
                  right. */}
              {actionVis.showRollback && previousStage && (
                <RollbackStatusButton
                  requestId={reqRow.id}
                  customerName={reqRow.customerName}
                  previousStage={{
                    id: previousStage.id,
                    name: previousStage.name,
                  }}
                />
              )}
              {actionVis.showReassign && currentExecForReassign && (
                <ReassignRequestButton
                  requestId={reqRow.id}
                  customerName={reqRow.customerName}
                  currentExec={currentExecForReassign}
                  candidates={reassignCandidates}
                />
              )}
              {actionVis.showReject && (
                <RejectRequestButton
                  requestId={reqRow.id}
                  customerName={reqRow.customerName}
                />
              )}
              {actionVis.showMarkRejected && (
                <MarkCustomerRejectedButton requestId={reqRow.id} />
              )}
              {actionVis.showMarkComplete && (
                <MarkInstallationCompleteButton requestId={reqRow.id} />
              )}
              {actionVis.showAssignExec && (
                <AssignRequestButton
                  requestId={reqRow.id}
                  execs={execsForAssignment}
                />
              )}
              {actionVis.showApprove && (
                <ApproveRequestButton
                  requestId={reqRow.id}
                  customerName={reqRow.customerName}
                />
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
