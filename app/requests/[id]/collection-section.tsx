import { asc, eq } from "drizzle-orm";

import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { db } from "@/db/client";
import { payments, quotations, users } from "@/db/schema";
import { type Role, USER_ROLES } from "@/lib/auth/roles";
import { formatInrFromPaise } from "@/lib/money";
import { formatIstDateTime } from "@/lib/request-detail";
import { cn } from "@/lib/utils";

import { PaymentRecordButton } from "./payment-record-button";
import { PaymentVoidButton } from "./payment-void-button";
import { QuotationEditButton } from "./quotation-edit-button";
import { RefundRecordButton } from "./refund-record-button";

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

  // Summary — voided rows excluded from totals.
  let inboundPaise = 0;
  let outboundPaise = 0;
  for (const p of paymentRows) {
    if (p.voidedAt !== null) continue;
    const amt = Number(p.amountPaise);
    if (p.direction === "inbound") inboundPaise += amt;
    else outboundPaise += amt;
  }
  const totalQuotedPaise = quotationRow
    ? Number(quotationRow.totalOrderValuePaise)
    : 0;
  const netReceivedPaise = inboundPaise - outboundPaise;
  const balancePaise = totalQuotedPaise - netReceivedPaise;

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

      {/* ---------- Payments block ---------- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
            Payments
          </h3>
          <div className="flex gap-2 flex-wrap">
            {canRecordPayment && <PaymentRecordButton requestId={requestId} />}
            {canRefund && <RefundRecordButton requestId={requestId} />}
          </div>
        </div>
        {paymentRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No payments recorded yet.
          </p>
        ) : (
          <ol className="space-y-2">
            {paymentRows.map((p) => {
              const voided = p.voidedAt !== null;
              const isRefund = p.direction === "outbound";
              return (
                <li
                  key={p.id}
                  className={cn(
                    "rounded-2xl border px-4 py-3",
                    voided && "bg-muted/50 opacity-60",
                    isRefund && !voided && "border-amber-500/40 bg-amber-500/5",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p
                        className={cn(
                          "text-base font-semibold font-mono",
                          voided && "line-through",
                        )}
                      >
                        {isRefund ? "−" : "+"}
                        {formatInrFromPaise(Number(p.amountPaise))}
                      </p>
                      <Badge variant="outline" className="text-[10px]">
                        {p.mode}
                      </Badge>
                      {isRefund && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] bg-amber-500/20 text-amber-900"
                        >
                          Refund
                        </Badge>
                      )}
                      {voided && (
                        <Badge variant="destructive" className="text-[10px]">
                          Voided
                        </Badge>
                      )}
                    </div>
                    {canVoid && !voided && (
                      <PaymentVoidButton
                        requestId={requestId}
                        paymentId={p.id}
                      />
                    )}
                  </div>
                  {p.label && (
                    <p className="text-xs mt-1 font-medium">{p.label}</p>
                  )}
                  {p.referenceNumber && (
                    <p className="text-xs mt-0.5 font-mono text-muted-foreground">
                      Ref: {p.referenceNumber}
                    </p>
                  )}
                  {p.notes && (
                    <p className="text-xs mt-1 whitespace-pre-wrap text-foreground/80">
                      {p.notes}
                    </p>
                  )}
                  <p className="text-[11px] mt-1 text-muted-foreground">
                    {p.paymentDate}
                    {p.recordedByName ? ` · ${p.recordedByName}` : ""}
                  </p>
                  {voided && p.voidedReason && (
                    <p className="text-[11px] mt-1 text-destructive">
                      <Icon
                        name="cancel"
                        size="xs"
                        className="inline align-text-bottom mr-1"
                      />
                      Voided: {p.voidedReason}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* ---------- Summary block ---------- */}
      <div className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
          Summary
        </h3>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm font-mono">
          <dt className="text-muted-foreground">Quoted</dt>
          <dd className="text-right">{formatInrFromPaise(totalQuotedPaise)}</dd>
          <dt className="text-muted-foreground">Received (inbound)</dt>
          <dd className="text-right">{formatInrFromPaise(inboundPaise)}</dd>
          <dt className="text-muted-foreground">Refunded (outbound)</dt>
          <dd className="text-right">{formatInrFromPaise(outboundPaise)}</dd>
          <dt className="text-muted-foreground border-t pt-1">Net received</dt>
          <dd className="text-right border-t pt-1 font-semibold">
            {formatInrFromPaise(netReceivedPaise)}
          </dd>
          <dt
            className={cn(
              "border-t pt-1",
              balancePaise <= 0
                ? "text-emerald-700"
                : "text-muted-foreground",
            )}
          >
            Balance due
          </dt>
          <dd
            className={cn(
              "text-right border-t pt-1 font-semibold",
              balancePaise <= 0 ? "text-emerald-700" : "text-foreground",
            )}
          >
            {formatInrFromPaise(Math.max(balancePaise, 0))}
          </dd>
        </dl>
      </div>
    </section>
  );
}
