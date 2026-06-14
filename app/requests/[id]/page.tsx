import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { formatDistanceToNow } from "date-fns";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { DispatchHistoryBlock } from "@/app/(support)/support/orders/[id]/_components/DispatchHistoryBlock";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { db } from "@/db/client";
import {
  cities,
  quotations,
  requestStatusHistory,
  salesExecutives,
  statusStages,
  users,
  visitRequests,
} from "@/db/schema";
import { loadTransitionByPair } from "@/lib/admin/transitions";
import { ROLE_HOME, isRole } from "@/lib/auth/roles";
import { getServerSession } from "@/lib/auth-server";
import { canCaptainEditRequest } from "@/lib/captain/edit-auth";
import { canExecEditRequest } from "@/lib/exec/edit-auth";
import {
  canWriteNoteForEntity,
  loadNotesForEntity,
} from "@/lib/notes/queries";

import { CopyTrackingLink } from "@/app/submitted/[token]/copy-tracking-link";
import { AdminHelpSection } from "@/components/admin-help/AdminHelpSection";
import { NotesSection } from "@/components/notes/NotesSection";
import { OrderCommentsBlock } from "@/components/order-comments/OrderCommentsBlock";
import { RescheduleButton } from "@/components/reschedule/RescheduleButton";
import { loadAdminHelpForRequest } from "@/lib/admin-help/actions";
import { REJECTION_REASONS, type RejectionReason } from "@/lib/rejection-reasons";
import {
  computeActionVisibility,
  formatIstDateTime,
  terminalBadgeMeta,
  type TerminalActor,
} from "@/lib/request-detail";
import { loadOrderDetail } from "@/lib/support/order-detail";
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
import { RequestDetailShell } from "./_components/RequestDetailShell";
import { StickyRequestHeader } from "./_components/StickyRequestHeader";

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
      // HVA-145: surface tracking URL so captain/exec can re-share with
      // customer if the original link is lost.
      trackingToken: visitRequests.trackingToken,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(eq(visitRequests.id, requestUuid))
    .limit(1);

  if (!reqRow) notFound();

  // HVA-252: load quotation source + portal metadata so we can render the
  // "From CartPlus" badge in the header and (for super_admin) the raw
  // payload viewer in the Admin tab. Separate query so this PR doesn't
  // perturb the main reqRow joins.
  const [quotationMeta] = await db
    .select({
      id: quotations.id,
      source: quotations.source,
      portalQuotationId: quotations.portalQuotationId,
      storeId: quotations.storeId,
      rawPayload: quotations.rawPayload,
      lastWebhookAt: quotations.lastWebhookAt,
    })
    .from(quotations)
    .where(eq(quotations.visitRequestId, reqRow.id))
    .limit(1);
  const isPortalOrigin = quotationMeta?.source === "portal";

  // 3. Per-role row-level visibility — the privacy boundary. The HVA-104
  // `canAdvance` flag was redundant with computeActionVisibility (HVA-66);
  // we just need the per-role redirect-or-allow decision here.
  if (role === "sales_executive" && reqRow.assignedExecUserId !== user.id) {
    redirect(ROLE_HOME_DENIED.sales_executive);
  }
  if (role === "captain") {
    // HVA-258: was city-scoped only (cityCaptainUserId === me), which
    // bounced even the request's OWN assigned captain whenever the city
    // had no captain set (e.g. the "Other" city) or belonged to someone
    // else. Captain visibility is team-scoped per the project lock:
    //   1. I accepted the request (assigned_captain_user_id = me), OR
    //   2. the assigned exec reports to me, OR
    //   3. I own the request's city (kept for the unassigned/SUBMITTED
    //      routing flow where no captain has accepted yet).
    let captainAllowed =
      reqRow.assignedCaptainUserId === user.id ||
      reqRow.cityCaptainUserId === user.id;
    if (!captainAllowed && reqRow.assignedExecUserId) {
      const [teamRow] = await db
        .select({ userId: salesExecutives.userId })
        .from(salesExecutives)
        .where(
          and(
            eq(salesExecutives.userId, reqRow.assignedExecUserId),
            eq(salesExecutives.captainUserId, user.id),
          ),
        )
        .limit(1);
      captainAllowed = Boolean(teamRow);
    }
    if (!captainAllowed) {
      redirect(ROLE_HOME_DENIED.captain);
    }
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
      code: statusStages.code,
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

  // HVA-288: bypassed earlier stages — active stages between Submitted
  // (seq 1) and the current stage that have NO history row. A CartPlus
  // online order is created straight at Quotation Given, so the home-visit
  // stages never happened; render them greyed/"skipped" so the full ladder
  // still shows. recordedSeqs is the set of every seq that appears in
  // history (rollback-safe: a stage actually visited is never "skipped").
  // For normal/merged requests every prior stage has history → empty set.
  const recordedSeqs = new Set(historyRows.map((h) => h.sequenceNumber));
  const priorStages = await db
    .select({
      id: statusStages.id,
      name: statusStages.name,
      sequenceNumber: statusStages.sequenceNumber,
    })
    .from(statusStages)
    .where(
      and(
        eq(statusStages.isActive, true),
        gt(statusStages.sequenceNumber, 1),
        lt(statusStages.sequenceNumber, reqRow.currentStageSeq),
      ),
    )
    .orderBy(asc(statusStages.sequenceNumber));
  const skippedStages = priorStages.filter(
    (s) => !recordedSeqs.has(s.sequenceNumber),
  );
  const skippedNote =
    quotationMeta?.source === "portal" ? "Skipped · online order" : "Skipped";

  // HVA-223: per-transition flags from status_transitions catalog.
  // Replaces the hardcoded `nextStatus.code === 'VISIT_SCHEDULED'`
  // check in AdvanceStatusButton — admin can now mark any transition
  // as needing a date+time picker via /admin/settings/workflow/transitions.
  const nextTransition = nextStage
    ? await loadTransitionByPair(reqRow.currentStageCode, nextStage.code)
    : null;
  const nextRequiresDatetime = nextTransition?.requiresDatetime ?? false;
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

  // HVA-145: base URL matches other notification composers — env override for
  // staging/local, defaults to prod.
  const trackingBaseUrl =
    process.env.BETTER_AUTH_URL ?? "https://visits.beakn.in";

  // HVA-191: fallback to the role's requests list (not the dashboard) when there
  // is no browser history. router.back() handles the common case.
  const backFallback = isRole(role)
    ? role === "captain"
      ? "/captain/requests"
      : role === "sales_executive"
        ? "/requests"
        : ROLE_HOME[role]
    : "/";
  const submittedIst = formatIstDateTime(reqRow.createdAt);
  const cancelledIst = formatIstDateTime(reqRow.cancelledAt);
  const terminalMeta = reqRow.cancelledAt
    ? terminalBadgeMeta(reqRow.cancellationActor as TerminalActor)
    : null;

  // HVA-159 + HVA-163: edit pencil now surfaces for exec (strict-D2),
  // captain (team-scoped), and super_admin. The role switch mirrors the
  // server action's three-way gate.
  let editable = role === "super_admin";
  if (!editable && role === "sales_executive") {
    editable = await canExecEditRequest(user.id, reqRow.id);
  }
  if (!editable && role === "captain") {
    editable = await canCaptainEditRequest(user.id, reqRow.id);
  }
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

  // HVA-73 PR 2: notes section data. Read auth is implicit — the page
  // already auth-gated above. Write auth lives in canWriteNoteForEntity.
  const [notesForRequest, canWriteNote] = await Promise.all([
    loadNotesForEntity("request", reqRow.id),
    isRole(role)
      ? canWriteNoteForEntity({ id: user.id, role }, "request", reqRow.id)
      : Promise.resolve(false),
  ]);
  const viewerForNotes = {
    id: user.id,
    fullName: (user as { fullName?: string; name?: string }).fullName ?? null,
    role: isRole(role) ? role : ("sales_executive" as const),
  };

  // HVA-243: read-only dispatch state for the Order tab (ORDER_CONFIRMED+).
  const orderConfirmedStages = new Set([
    "ORDER_CONFIRMED",
    "INSTALLATION_SCHEDULED",
    "INSTALLATION_DONE",
    "ORDER_EXECUTED_SUCCESSFULLY",
  ]);
  const showOrderActivity = orderConfirmedStages.has(reqRow.currentStageCode);
  const dispatchesForRequest = showOrderActivity
    ? (await loadOrderDetail(reqRow.id))?.dispatches ?? []
    : [];

  // HVA-243: resolve the single primary action surfaced in the sticky
  // header. Priority approve > markComplete > advance > assignExec.
  // Every other verb (rollback / reassign / reject / mark rejected /
  // reschedule) lives in the Admin tab where it belongs.
  let primaryAction: React.ReactNode = null;
  if (actionVis.showApprove) {
    primaryAction = (
      <ApproveRequestButton
        requestId={reqRow.id}
        customerName={reqRow.customerName}
      />
    );
  } else if (actionVis.showMarkComplete) {
    primaryAction = <MarkInstallationCompleteButton requestId={reqRow.id} />;
  } else if (actionVis.showAdvance && nextStage) {
    primaryAction = (
      <AdvanceStatusButton
        requestId={reqRow.id}
        nextStatus={{
          id: nextStage.id,
          code: nextStage.code,
          name: nextStage.name,
        }}
        requiresDatetime={nextRequiresDatetime}
      />
    );
  } else if (actionVis.showAssignExec) {
    primaryAction = (
      <AssignRequestButton
        requestId={reqRow.id}
        execs={execsForAssignment}
      />
    );
  }

  const statusBadge =
    reqRow.cancelledAt !== null ? (
      <>
        <Badge variant="destructive" className="text-[10px]">
          Cancelled
        </Badge>
        <Badge
          variant="outline"
          className="text-[10px] text-muted-foreground"
        >
          was {reqRow.currentStageName}
        </Badge>
      </>
    ) : (
      <Badge variant="secondary" className="text-[10px]">
        {reqRow.currentStageName}
      </Badge>
    );

  const editButton =
    editable && editRequestPayload ? (
      <EditRequestButton
        request={editRequestPayload}
        cities={editCityRows}
      />
    ) : null;

  const banner = (
    <>
      {reqRow.cancelledAt && terminalMeta && (
        <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Icon name="cancel" size="sm" className="text-destructive" />
            <h2 className="text-sm font-semibold tracking-tight text-destructive">
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
                <dd className="whitespace-pre-wrap">
                  {reqRow.cancellationReason}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Marked by</dt>
            <dd>{terminalMeta.markedByLabel}</dd>
            <dt className="text-muted-foreground">When</dt>
            <dd>{cancelledIst ?? "—"}</dd>
          </dl>
        </section>
      )}
      {reqRow.currentStageCode === "PENDING_CAPTAIN_APPROVAL" &&
        role === "sales_executive" &&
        reqRow.assignedExecUserId === user.id && (
          <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Icon
                name="hourglass_top"
                size="sm"
                className="text-amber-700"
              />
              <h2 className="text-sm font-semibold tracking-tight text-amber-900">
                Waiting for {cityCaptainName ?? "your captain"} to approve
              </h2>
            </div>
            {pendingApprovalNote ? (
              <div className="rounded-xl bg-background/70 border px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                  Your note
                </p>
                <p className="text-sm whitespace-pre-wrap">
                  {pendingApprovalNote}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No note was attached when you marked installation complete.
              </p>
            )}
          </section>
        )}
    </>
  );

  const overviewTab = (
    <Accordion
      type="multiple"
      defaultValue={["customer-info"]}
      className="rounded-2xl border bg-card divide-y px-4"
    >
      <AccordionItem value="customer-info" className="border-b">
        <AccordionTrigger>
          <span>Customer info</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              {reqRow.bhk}
            </Badge>
            {interest.map((it) => (
              <Badge key={it} variant="outline" className="text-[10px]">
                {it}
              </Badge>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Phone
              </p>
              <Button
                asChild
                variant="outline"
                className="h-11 w-full justify-start font-mono text-primary"
              >
                <a
                  href={`tel:${reqRow.customerPhone}`}
                  aria-label="Call customer"
                >
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
                <Button
                  asChild
                  variant="outline"
                  className="h-11 w-full justify-start text-primary"
                >
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
              <Icon
                name="schedule"
                size="xs"
                className="inline align-text-bottom mr-1"
              />
              Submitted {submittedIst}
            </p>
          )}
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="address">
        <AccordionTrigger>
          <span>Address</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Address
            </span>
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
            <Button asChild variant="outline" size="sm">
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
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="tracking">
        <AccordionTrigger>
          <span>Customer tracking link</span>
        </AccordionTrigger>
        <AccordionContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Share this with the customer to view their request status.
          </p>
          <CopyTrackingLink
            url={`${trackingBaseUrl}/track/${reqRow.trackingToken}`}
            shareTitle={`Track your Beakn visit — ${reqRow.customerName}`}
            shareText={`Hi ${reqRow.customerName}, here's the link to track your Beakn visit request.`}
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );

  const orderTab = (
    <Accordion
      type="multiple"
      defaultValue={["quotation"]}
      className="rounded-2xl border bg-card divide-y px-4"
    >
      <AccordionItem value="quotation" className="border-b">
        <AccordionTrigger>
          <span>Quotation, items &amp; payments</span>
        </AccordionTrigger>
        <AccordionContent>
          <CollectionSection
            requestId={reqRow.id}
            role={isRole(role) ? role : undefined}
            userId={user.id}
            assignedExecUserId={reqRow.assignedExecUserId}
            cityCaptainUserId={reqRow.cityCaptainUserId}
            cancelledAt={reqRow.cancelledAt}
          />
        </AccordionContent>
      </AccordionItem>
      {showOrderActivity && (
        <AccordionItem value="dispatch">
          <AccordionTrigger>
            <span>Dispatch history ({dispatchesForRequest.length})</span>
          </AccordionTrigger>
          <AccordionContent>
            <DispatchHistoryBlock
              canAdvance={false}
              dispatches={dispatchesForRequest.map((d) => ({
                dispatchId: d.dispatchId,
                createdAtIso: d.createdAt.toISOString(),
                dispatchedByName: d.dispatchedByName,
                notes: d.notes,
                currentStage: d.currentStage,
                items: d.items,
              }))}
            />
          </AccordionContent>
        </AccordionItem>
      )}
    </Accordion>
  );

  const activityTab = (
    <Accordion
      type="multiple"
      defaultValue={["timeline"]}
      className="rounded-2xl border bg-card divide-y px-4"
    >
      <AccordionItem value="timeline" className="border-b">
        <AccordionTrigger>
          <span>
            Status timeline {isTerminal && "· Completed"}
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <ol className="space-y-3">
            <TimelineRow
              stageName="Submitted"
              when={reqRow.createdAt}
              changedByName="Customer"
              reason={null}
              variant={historyRows.length === 0 ? "current" : "past"}
            />
            {/* HVA-288: stages a CartPlus online order bypassed. */}
            {skippedStages.map((s) => (
              <TimelineRow
                key={s.id}
                stageName={s.name}
                when={null}
                changedByName={null}
                reason={null}
                variant="skipped"
                note={skippedNote}
              />
            ))}
            {historyRows.map((h) => {
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
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="notes">
        <AccordionTrigger>
          <span>Notes ({notesForRequest.length})</span>
        </AccordionTrigger>
        <AccordionContent>
          <NotesSection
            targetType="request"
            targetId={reqRow.id}
            notes={notesForRequest}
            canWrite={canWriteNote}
            viewer={viewerForNotes}
            embedded
          />
        </AccordionContent>
      </AccordionItem>
      {showOrderActivity && (
        <AccordionItem value="comments">
          <AccordionTrigger>
            <span>Order comments</span>
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-xs text-muted-foreground mb-3">
              Internal thread with the support team handling dispatch.
            </p>
            <OrderCommentsBlock
              requestId={reqRow.id}
              currentUserId={user.id}
            />
          </AccordionContent>
        </AccordionItem>
      )}
    </Accordion>
  );

  // Secondary actions (everything that's NOT the primary CTA) live in
  // the Admin tab. Rendered only when at least one is visible.
  const hasSecondaryActions =
    actionVis.showRollback ||
    actionVis.showReassign ||
    actionVis.showReject ||
    actionVis.showMarkRejected;
  const canReschedule =
    (role === "sales_executive" || role === "super_admin") &&
    (role === "super_admin" || reqRow.assignedExecUserId === user.id) &&
    !!reqRow.visitScheduledAt &&
    reqRow.cancelledAt === null &&
    reqRow.currentStageCode !== "ORDER_EXECUTED_SUCCESSFULLY";
  const showAdminHelp =
    role === "sales_executive" && reqRow.assignedExecUserId === user.id;

  const adminTab = (
    <Accordion
      type="multiple"
      defaultValue={[]}
      className="rounded-2xl border bg-card divide-y px-4"
    >
      {hasSecondaryActions && (
        <AccordionItem value="manage" className="border-b">
          <AccordionTrigger>
            <span>Manage request</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-2">
            <div className="flex flex-wrap gap-2">
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
            </div>
          </AccordionContent>
        </AccordionItem>
      )}
      {canReschedule && (
        <AccordionItem value="reschedule">
          <AccordionTrigger>
            <span>Reschedule visit</span>
          </AccordionTrigger>
          <AccordionContent>
            <RescheduleButton
              requestId={reqRow.id}
              currentVisitScheduledAt={reqRow.visitScheduledAt}
            />
          </AccordionContent>
        </AccordionItem>
      )}
      {showAdminHelp && (
        <AccordionItem value="admin-help">
          <AccordionTrigger>
            <span>Admin help</span>
          </AccordionTrigger>
          <AccordionContent>
            <AdminHelpSection
              requestId={reqRow.id}
              messages={await loadAdminHelpForRequest(reqRow.id)}
              embedded
            />
          </AccordionContent>
        </AccordionItem>
      )}
      {/* HVA-252: portal raw payload viewer — super_admin only on
          portal-origin requests. Useful for troubleshooting webhook
          deliveries without DB access. */}
      {role === "super_admin" && isPortalOrigin && quotationMeta && (
        <AccordionItem value="portal-payload">
          <AccordionTrigger>
            <span>CartPlus raw payload</span>
          </AccordionTrigger>
          <AccordionContent className="space-y-2">
            <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              <div>
                <span className="font-medium text-foreground/70">
                  Portal order ID
                </span>{" "}
                {quotationMeta.portalQuotationId ?? "—"}
              </div>
              <div>
                <span className="font-medium text-foreground/70">
                  Store ID
                </span>{" "}
                {quotationMeta.storeId ?? "—"}
              </div>
              <div className="sm:col-span-2">
                <span className="font-medium text-foreground/70">
                  Last webhook
                </span>{" "}
                {quotationMeta.lastWebhookAt
                  ? quotationMeta.lastWebhookAt.toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })
                  : "Never"}
              </div>
            </div>
            <pre className="rounded-md border bg-muted px-3 py-2 text-[11px] font-mono overflow-x-auto max-h-96">
              {JSON.stringify(quotationMeta.rawPayload, null, 2)}
            </pre>
          </AccordionContent>
        </AccordionItem>
      )}
      {!hasSecondaryActions &&
        !canReschedule &&
        !showAdminHelp &&
        !(role === "super_admin" && isPortalOrigin) && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No admin actions available at this stage.
          </div>
        )}
    </Accordion>
  );

  // Initial tab: ORDER_CONFIRMED+ requests open on Order tab so the
  // dispatch state is one click away; everything else opens on Overview.
  const initialTab: "overview" | "order" | "activity" | "admin" =
    showOrderActivity ? "order" : "overview";

  return (
    <main className="min-h-svh bg-background">
      <StickyRequestHeader
        customerName={reqRow.customerName}
        customerPhone={reqRow.customerPhone}
        cityName={reqRow.cityName}
        statusBadge={statusBadge}
        backFallback={backFallback}
        primaryAction={primaryAction}
        editButton={editButton}
        sourceBadge={
          isPortalOrigin ? (
            <Badge
              variant="outline"
              className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/30"
            >
              From CartPlus
            </Badge>
          ) : null
        }
      />
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-5">
        <RequestDetailShell
          initialTab={initialTab}
          banner={banner}
          overview={overviewTab}
          order={orderTab}
          activity={activityTab}
          admin={adminTab}
        />
      </div>
    </main>
  );
}

interface TimelineRowProps {
  stageName: string;
  when: Date | null;
  changedByName: string | null;
  reason: string | null;
  variant: "past" | "current" | "future" | "skipped";
  // HVA-288: short tag for the skipped variant, e.g. "Skipped · online order".
  note?: string | null;
}

function TimelineRow({
  stageName,
  when,
  changedByName,
  reason,
  variant,
  note,
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
        variant === "skipped" && "border-l-muted text-muted-foreground/60",
      )}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <p
          className={cn(
            "text-sm font-semibold tracking-tight",
            variant === "future" && "font-medium",
            variant === "skipped" && "font-medium line-through decoration-muted-foreground/40",
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
        {variant === "skipped" && (
          <span className="text-[10px] uppercase tracking-wide">
            {note ?? "Skipped"}
          </span>
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
