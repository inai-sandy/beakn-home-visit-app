import { asc, eq } from "drizzle-orm";

import { Badge } from "@/components/ui/badge";
import { db } from "@/db/client";
import { payments, quotations, users, visitRequests } from "@/db/schema";
import { type Role, USER_ROLES } from "@/lib/auth/roles";
import { computeCollectionSummary } from "@/lib/collection-summary";
import { formatInrFromPaise } from "@/lib/money";
import { formatIstDateTime } from "@/lib/request-detail";
import { cn } from "@/lib/utils";

import { loadLineItems } from "./_actions/lineItems";
import { LineItemsSection } from "./line-items-section";
import { PaymentsBlock } from "./payments-block";
import { TargetEditButton } from "./target-edit-button";

// =============================================================================
// HVA-70: Collection section on /requests/[id]
// =============================================================================
//
// Three vertical sub-blocks: Quotation, Payments, Summary. Server-rendered
// reads + small client islands for the action buttons. Visibility rules:
//
//   * Quotation Edit:    exec assigned / captain-of-city / super_admin,
//                        non-terminal request
//   * Add Payment:       exec assigned / captain / admin, non-terminal
//   * Add Refund:        captain-of-city / admin only, non-terminal
//   * Void Payment:      captain-of-city / admin only, per non-voided row
//
// HVA-70 design deviations (vs Linear body):
//   1. No quotation builder / GST / PDF — headline total + notes only.
//   2. Ad-hoc payments only — no milestone enum.
//   3. NO auto-advance of request status when paid in full.
//   4. Refunds require captain-of-city or super_admin (assigned exec
//      CANNOT issue refunds).
//   5. Quotation is MUTABLE — every revision audited.
// =============================================================================

interface Props {
  requestId: string;
  role: Role | undefined;
  userId: string;
  assignedExecUserId: string | null;
  cityCaptainUserId: string | null;
  cancelledAt: Date | null;
}

export async function CollectionSection({
  requestId,
  role,
  userId,
  assignedExecUserId,
  cityCaptainUserId,
  cancelledAt,
}: Props) {
  const isAdmin = role === USER_ROLES.SUPER_ADMIN;
  const isCaptainOfCity =
    role === USER_ROLES.CAPTAIN && cityCaptainUserId === userId;
  const isAssignedExec =
    role === USER_ROLES.SALES_EXECUTIVE && assignedExecUserId === userId;

  // HVA-281: execs/captains/admin set the TARGET; the quotation is now
  // read-only (it comes from CartPlus). Same authz gate, repurposed.
  const canEditTarget =
    !cancelledAt && (isAdmin || isCaptainOfCity || isAssignedExec);
  const canRecordPayment = canEditTarget;
  const canRefund = !cancelledAt && (isAdmin || isCaptainOfCity);
  const canVoid = isAdmin || isCaptainOfCity;

  // HVA-281: the exec's target lives on the request.
  const [requestRow] = await db
    .select({ targetValuePaise: visitRequests.targetValuePaise })
    .from(visitRequests)
    .where(eq(visitRequests.id, requestId))
    .limit(1);
  const targetValuePaise = requestRow?.targetValuePaise ?? null;

  const [quotationRow] = await db
    .select({
      id: quotations.id,
      quotationNumber: quotations.quotationNumber,
      totalOrderValuePaise: quotations.totalOrderValuePaise,
      notes: quotations.notes,
      source: quotations.source,
      submittedAt: quotations.submittedAt,
      submittedByName: users.fullName,
      updatedAt: quotations.updatedAt,
      updatedByUserId: quotations.updatedByUserId,
    })
    .from(quotations)
    .leftJoin(users, eq(users.id, quotations.submittedByUserId))
    .where(eq(quotations.visitRequestId, requestId))
    .limit(1);

  // HVA-281: only a CartPlus (portal) quotation is the real "Quotation".
  // A leftover manual row (test data / orphaned route) is ignored here and
  // never feeds finance — its value, if any, lived as the target.
  const portalQuotation =
    quotationRow && quotationRow.source === "portal" ? quotationRow : null;

  // HVA-234: load line items for the CartPlus quotation. loadLineItems
  // already excludes items removed by a CartPlus edit (HVA-280).
  const lineItems = portalQuotation
    ? await loadLineItems(portalQuotation.id)
    : [];

  const paymentRows = await db
    .select({
      id: payments.id,
      direction: payments.direction,
      amountPaise: payments.amountPaise,
      paymentDate: payments.paymentDate,
      mode: payments.mode,
      label: payments.label,
      referenceNumber: payments.referenceNumber,
      notes: payments.notes,
      voidedAt: payments.voidedAt,
      voidedReason: payments.voidedReason,
      voidedByUserId: payments.voidedByUserId,
      createdAt: payments.createdAt,
      recordedByName: users.fullName,
    })
    .from(payments)
    .leftJoin(users, eq(users.id, payments.recordedByUserId))
    .where(eq(payments.visitRequestId, requestId))
    .orderBy(asc(payments.paymentDate), asc(payments.createdAt));

  // Summary — voided rows excluded from totals. Shared with the tests
  // via lib/collection-summary.ts so the math stays a single source.
  const summary = computeCollectionSummary(
    portalQuotation ? Number(portalQuotation.totalOrderValuePaise) : 0,
    paymentRows.map((p) => ({
      direction: p.direction,
      amountPaise: Number(p.amountPaise),
      voidedAt: p.voidedAt,
    })),
  );

  return (
    <section
      aria-label="Collection"
      className="rounded-3xl border bg-card p-6 shadow-sm space-y-6"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Collection</h2>
        {cancelledAt && (
          <span className="text-xs text-muted-foreground">Read-only — cancelled</span>
        )}
      </header>

      {/* ---------- Target block (HVA-281) ----------
          The exec's goal for this request. A plain number, not finance. */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
            Target value
          </h3>
          {canEditTarget && (
            <TargetEditButton
              requestId={requestId}
              existingPaise={targetValuePaise}
            />
          )}
        </div>
        {targetValuePaise !== null ? (
          <div className="rounded-2xl border bg-muted/30 p-4">
            <p className="text-2xl font-semibold tracking-tight font-mono">
              {formatInrFromPaise(Number(targetValuePaise))}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              The exec&apos;s goal. The actual quotation comes from CartPlus.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No target set yet.</p>
        )}
      </div>

      {/* ---------- Quotation block (HVA-281) — read-only, from CartPlus ---------- */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
          Quotation <span className="normal-case font-normal">· from CartPlus</span>
        </h3>
        {portalQuotation ? (
          <div className="rounded-2xl border bg-muted/30 p-4 space-y-2">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <p className="text-2xl font-semibold tracking-tight font-mono">
                {formatInrFromPaise(Number(portalQuotation.totalOrderValuePaise))}
              </p>
              {portalQuotation.quotationNumber && (
                <Badge variant="outline" className="text-[10px]">
                  #{portalQuotation.quotationNumber}
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Synced from CartPlus
              {portalQuotation.updatedAt
                ? ` · updated ${formatIstDateTime(portalQuotation.updatedAt) ?? ""}`
                : ""}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No CartPlus quotation linked yet.
          </p>
        )}
      </div>

      {/* ---------- Line items block (HVA-234) — CartPlus items, read-only ---------- */}
      {portalQuotation && (
        <LineItemsSection
          quotationId={portalQuotation.id}
          items={lineItems}
          canEdit={false}
        />
      )}

      {/* ---------- Payments block ----------
          HVA-150 / HVA-200: rendering moved to client wrapper so
          Add Payment can hold optimistic state. Summary block below
          stays server-rendered (SSOT math survives the carve-out;
          summary catches up on the next router.refresh ~200ms later). */}
      <PaymentsBlock
        requestId={requestId}
        rows={paymentRows.map((p) => ({
          id: p.id,
          direction: p.direction,
          amountPaise: Number(p.amountPaise),
          paymentDate: p.paymentDate,
          mode: p.mode,
          label: p.label,
          referenceNumber: p.referenceNumber,
          notes: p.notes,
          voidedAt: p.voidedAt,
          voidedReason: p.voidedReason,
          recordedByName: p.recordedByName,
        }))}
        canRecordPayment={canRecordPayment}
        canRefund={canRefund}
        canVoid={canVoid}
      />

      {/* ---------- Summary block ---------- */}
      <div className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
          Summary
        </h3>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm font-mono">
          <dt className="text-muted-foreground">Quoted</dt>
          <dd className="text-right">
            {formatInrFromPaise(summary.quotedPaise)}
          </dd>
          <dt className="text-muted-foreground">Received (inbound)</dt>
          <dd className="text-right">
            {formatInrFromPaise(summary.inboundPaise)}
          </dd>
          <dt className="text-muted-foreground">Refunded (outbound)</dt>
          <dd className="text-right">
            {formatInrFromPaise(summary.outboundPaise)}
          </dd>
          <dt className="text-muted-foreground border-t pt-1">Net received</dt>
          <dd className="text-right border-t pt-1 font-semibold">
            {formatInrFromPaise(summary.netReceivedPaise)}
          </dd>
          {/*
            Three-way branch:
              - overpaid (balance < 0) → amber "Overpaid", magnitude shown
                via -balancePaise. Open obligation — math is settled but
                we owe the customer. Distinct from "fully collected".
              - fully collected (balance == 0) → green "Balance due: ₹0".
              - outstanding (balance > 0) → destructive red "Balance due".
          */}
          {summary.isOverpaid ? (
            <>
              <dt className="border-t pt-1 text-amber-700">Overpaid</dt>
              <dd className="text-right border-t pt-1 font-semibold text-amber-700">
                {formatInrFromPaise(summary.overpaidPaise)}
              </dd>
            </>
          ) : (
            <>
              <dt
                className={cn(
                  "border-t pt-1",
                  summary.isFullyCollected
                    ? "text-emerald-700"
                    : "text-destructive",
                )}
              >
                Balance due
              </dt>
              <dd
                className={cn(
                  "text-right border-t pt-1 font-semibold",
                  summary.isFullyCollected
                    ? "text-emerald-700"
                    : "text-destructive",
                )}
              >
                {formatInrFromPaise(summary.balancePaise)}
              </dd>
            </>
          )}
        </dl>
      </div>
    </section>
  );
}
