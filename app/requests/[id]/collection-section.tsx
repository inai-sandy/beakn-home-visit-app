import { asc, eq } from "drizzle-orm";

import { Badge } from "@/components/ui/badge";
import { db } from "@/db/client";
import { payments, quotations, users } from "@/db/schema";
import { type Role, USER_ROLES } from "@/lib/auth/roles";
import { computeCollectionSummary } from "@/lib/collection-summary";
import { formatInrFromPaise } from "@/lib/money";
import { formatIstDateTime } from "@/lib/request-detail";
import { cn } from "@/lib/utils";

import { loadLineItems } from "./_actions/lineItems";
import { LineItemsSection } from "./line-items-section";
import { PaymentsBlock } from "./payments-block";
import { QuotationEditButton } from "./quotation-edit-button";

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

  const canEditQuotation =
    !cancelledAt && (isAdmin || isCaptainOfCity || isAssignedExec);
  const canRecordPayment = canEditQuotation;
  const canRefund = !cancelledAt && (isAdmin || isCaptainOfCity);
  const canVoid = isAdmin || isCaptainOfCity;

  const [quotationRow] = await db
    .select({
      id: quotations.id,
      quotationNumber: quotations.quotationNumber,
      totalOrderValuePaise: quotations.totalOrderValuePaise,
      notes: quotations.notes,
      submittedAt: quotations.submittedAt,
      submittedByName: users.fullName,
      updatedAt: quotations.updatedAt,
      updatedByUserId: quotations.updatedByUserId,
    })
    .from(quotations)
    .leftJoin(users, eq(users.id, quotations.submittedByUserId))
    .where(eq(quotations.visitRequestId, requestId))
    .limit(1);

  // Separate query for the "updated by" name so we don't need two joins
  // on the same users table (drizzle alias dance). Empty when first-write.
  let updatedByName: string | null = null;
  if (quotationRow?.updatedByUserId) {
    const [u] = await db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, quotationRow.updatedByUserId))
      .limit(1);
    updatedByName = u?.fullName ?? null;
  }

  // HVA-234: load line items for this quotation. Only when a quotation
  // exists — line items can't exist without a parent quotation row.
  const lineItems = quotationRow
    ? await loadLineItems(quotationRow.id)
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
    quotationRow ? Number(quotationRow.totalOrderValuePaise) : 0,
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

      {/* ---------- Quotation block ---------- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
            Quotation
          </h3>
          {canEditQuotation && (
            <QuotationEditButton
              requestId={requestId}
              existing={
                quotationRow
                  ? {
                      totalOrderValuePaise: Number(
                        quotationRow.totalOrderValuePaise,
                      ),
                      quotationNumber: quotationRow.quotationNumber,
                      notes: quotationRow.notes,
                    }
                  : null
              }
            />
          )}
        </div>
        {quotationRow ? (
          <div className="rounded-2xl border bg-muted/30 p-4 space-y-2">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <p className="text-2xl font-semibold tracking-tight font-mono">
                {formatInrFromPaise(Number(quotationRow.totalOrderValuePaise))}
              </p>
              {quotationRow.quotationNumber && (
                <Badge variant="outline" className="text-[10px]">
                  #{quotationRow.quotationNumber}
                </Badge>
              )}
            </div>
            {quotationRow.notes && (
              <p className="text-xs whitespace-pre-wrap text-foreground/80">
                {quotationRow.notes}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Submitted {formatIstDateTime(quotationRow.submittedAt) ?? "—"}
              {quotationRow.submittedByName
                ? ` · ${quotationRow.submittedByName}`
                : ""}
              {updatedByName && quotationRow.updatedAt
                ? ` · revised ${formatIstDateTime(quotationRow.updatedAt) ?? ""} by ${updatedByName}`
                : ""}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No quotation recorded yet.
          </p>
        )}
      </div>

      {/* ---------- Line items block (HVA-234) ----------
          Renders below the quotation headline. Visible when a quotation
          exists; the section internally hides itself if items list is
          empty AND user can't edit. Edit gate matches the quotation
          edit gate (same authz applies). */}
      {quotationRow && (
        <LineItemsSection
          quotationId={quotationRow.id}
          items={lineItems}
          canEdit={canEditQuotation}
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
