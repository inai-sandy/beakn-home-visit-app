import { and, asc, eq, gt } from "drizzle-orm";
import { formatDistanceToNow, format } from "date-fns";
import type { Metadata } from "next";
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
import { getServerSession } from "@/lib/auth-server";
import { cn } from "@/lib/utils";

import { AdvanceStatusButton } from "./advance-status-button";
import { CopyAddressButton } from "./copy-address-button";
import { MarkInstallationCompleteButton } from "./mark-installation-complete-button";

// =============================================================================
// HVA-104: /requests/[id] — request detail screen MVP
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
// LAYOUT:
//   1. Customer info card (top) — name + tel/mailto + address w/ Copy +
//      BHK + interest tags + Open Maps (when lat AND lng both present)
//   2. Status timeline — synthetic "Submitted" entry from created_at,
//      then each request_status_history row (oldest first), then dimmed
//      "Pending" entries for stages above current sequence_number
//   3. Forward action button — "Move to {next stage}". Hidden at
//      terminal stage. POSTs to HVA-67's endpoint.
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
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(eq(visitRequests.id, requestUuid))
    .limit(1);

  if (!reqRow) notFound();

  // 3. Per-role row-level visibility — the privacy boundary.
  let canAdvance = false;
  if (role === "super_admin") {
    canAdvance = true;
  } else if (role === "sales_executive") {
    if (reqRow.assignedExecUserId !== user.id) {
      redirect(ROLE_HOME_DENIED.sales_executive);
    }
    canAdvance = true;
  } else if (role === "captain") {
    if (reqRow.cityCaptainUserId !== user.id) {
      redirect(ROLE_HOME_DENIED.captain);
    }
    canAdvance = true;
  } else {
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

  return (
    <main className="min-h-svh bg-background">
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
              <Badge variant="secondary" className="text-[10px]">
                {reqRow.currentStageName}
              </Badge>
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

          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Phone
              </p>
              <a
                href={`tel:${reqRow.customerPhone}`}
                className="font-mono text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm inline-flex items-center gap-1"
              >
                <Icon name="phone" size="xs" />
                {reqRow.customerPhone}
              </a>
            </div>
            {reqRow.customerEmail && (
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Email
                </p>
                <a
                  href={`mailto:${reqRow.customerEmail}`}
                  className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm inline-flex items-center gap-1 truncate"
                >
                  <Icon name="mail" size="xs" />
                  <span className="truncate">{reqRow.customerEmail}</span>
                </a>
              </div>
            )}
          </div>

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

        {!isTerminal && nextStage && canAdvance && (() => {
          // HVA-68: When current stage is INSTALLATION_SCHEDULED or
          // INSTALLATION_CONFIGURATION_DONE, show "Mark Installation
          // Complete" alongside the generic next-stage button. The
          // Mark button is visible to the assigned exec or super_admin
          // (captain dashboards get their own Approve/Reject in HVA-80).
          const showMarkComplete =
            (reqRow.currentStageCode === "INSTALLATION_SCHEDULED" ||
              reqRow.currentStageCode === "INSTALLATION_CONFIGURATION_DONE") &&
            (role === "super_admin" ||
              (role === "sales_executive" &&
                reqRow.assignedExecUserId === user.id));

          // HVA-68: at PENDING_CAPTAIN_APPROVAL the request is waiting for
          // the captain's Approve/Reject action — that surface ships with
          // HVA-80. Hide the generic Move button for execs here so they
          // don't bypass the captain by clicking it. Captain + super_admin
          // still see the button (captain needs to drive the next step;
          // super_admin is the escape hatch).
          const hideGenericAdvance =
            reqRow.currentStageCode === "PENDING_CAPTAIN_APPROVAL" &&
            role === "sales_executive";

          return (
            <section className="flex justify-end gap-3 flex-wrap">
              {showMarkComplete && (
                <MarkInstallationCompleteButton requestId={reqRow.id} />
              )}
              {!hideGenericAdvance && (
                <AdvanceStatusButton
                  requestId={reqRow.id}
                  nextStatus={{ id: nextStage.id, name: nextStage.name }}
                />
              )}
            </section>
          );
        })()}
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
  const absolute = when ? format(when, "yyyy-MM-dd HH:mm") : null;
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
