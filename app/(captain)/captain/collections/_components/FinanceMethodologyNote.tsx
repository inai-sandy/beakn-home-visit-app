'use client';

import { useState } from 'react';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

// =============================================================================
// PR12-FIX3 2026-05-27: collapsible "How this is calculated" panel
// =============================================================================
//
// Sandeep asked explicitly for the math to be visible. Default closed
// (universal accordion rule) — captain opens when they want to verify
// a figure. Plain language; no SQL or jargon.
// =============================================================================

export function FinanceMethodologyNote() {
  const [open, setOpen] = useState(false);

  return (
    <section
      aria-label="How these numbers are calculated"
      className={cn(
        'rounded-3xl border bg-card shadow-sm overflow-hidden',
        open ? '' : '',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30 text-left"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2">
          <Icon
            name="info"
            size="sm"
            className="text-muted-foreground"
            aria-hidden
          />
          <span className="text-sm font-medium">
            How are these numbers calculated?
          </span>
        </span>
        <Icon
          name="expand_more"
          size="sm"
          className={cn(
            'text-muted-foreground transition-transform',
            open ? 'rotate-180' : '',
          )}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 text-sm space-y-3 text-foreground/90">
          <div className="space-y-1">
            <p className="font-semibold tracking-tight">In scope</p>
            <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
              <li>
                Every <strong>quoted</strong> request — a quotation row
                exists for it. Requests without a quotation aren&apos;t
                shown.
              </li>
              <li>
                <strong>Cancelled</strong> requests are excluded everywhere.
              </li>
              <li>
                <strong>Voided</strong> payments don&apos;t count toward
                Received.
              </li>
              <li>
                Captain only sees requests on their team
                (assigned-captain = me, or unassigned-in-my-cities).
                Super-admin sees everything.
              </li>
            </ul>
          </div>

          <div className="space-y-1">
            <p className="font-semibold tracking-tight">The four tiles</p>
            <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
              <li>
                <strong>Order Book</strong> = sum of quotation totals where
                the request is at <em>Order Confirmed</em> or later
                (Installation Scheduled, Installation &amp; Configuration
                Done, Pending Captain Approval, Order Executed
                Successfully). &ldquo;Confirmed money.&rdquo;
              </li>
              <li>
                <strong>Quotation Pipeline</strong> = sum of quotation
                totals where the request is BEFORE Order Confirmed
                (Submitted / Assigned / Visit Scheduled / Visit Completed
                / Quotation Given). &ldquo;Quoted but not yet
                confirmed.&rdquo;
              </li>
              <li>
                <strong>Received</strong> = sum of every inbound payment
                minus every outbound refund on quoted requests, across
                both Order Book and Pipeline. Pre-confirmation deposits
                are counted.
              </li>
              <li>
                <strong>Outstanding</strong> = (Order Book + Quotation
                Pipeline) − Received. Negative means the customer has a
                credit balance with us (refund exceeded inbound).
              </li>
            </ul>
          </div>

          <div className="space-y-1">
            <p className="font-semibold tracking-tight">Aging buckets</p>
            <p className="text-xs text-muted-foreground">
              For every quoted request with a positive outstanding
              balance: age = today − quotation submission date. Bucketed
              0–7 days / 8–30 days / 30+ days. The bar widths show
              relative share, not absolute paise.
            </p>
          </div>

          <div className="space-y-1">
            <p className="font-semibold tracking-tight">Filters</p>
            <p className="text-xs text-muted-foreground">
              Every filter (search, exec, city, section pill) applies
              uniformly to all four tiles + aging buckets + the order
              list. The list sort default is <em>Outstanding desc</em> so
              the biggest collections land at the top.
            </p>
          </div>

          <div className="space-y-1">
            <p className="font-semibold tracking-tight">When a number looks wrong</p>
            <p className="text-xs text-muted-foreground">
              Common causes: (a) request is cancelled (excluded);
              (b) payment was voided (excluded); (c) you&apos;re viewing
              with a stale filter — clear search/exec/city and toggle
              section to &ldquo;All&rdquo;; (d) the request belongs to a
              different captain&apos;s team.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
