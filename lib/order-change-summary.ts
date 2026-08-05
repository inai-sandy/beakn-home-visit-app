import { formatInrFromPaise } from '@/lib/money';

// =============================================================================
// HVA-325: one sentence describing a CartPlus order edit
// =============================================================================
//
// Used by the request timeline. Kept pure and out of the page component so
// the wording is unit-testable — this is the line someone reads three days
// later when they are asking why the value is not what they confirmed, and
// it has to be right without a browser to check it in.
//
// The notification composer (lib/notifications/compose/cartplus-order-changed)
// says the same thing in its own voice; it is deliberately not shared. The
// timeline entry is a record ("what happened"), the notification is an alert
// ("this needs your attention") — collapsing them into one string would make
// both worse the first time either needs to change.
// =============================================================================

export interface OrderChangeSummaryInput {
  previousTotalPaise: number;
  newTotalPaise: number;
  previousItemCount: number;
  newItemCount: number;
  itemsAdded: number;
  itemsRemoved: number;
  itemsAmended: number;
}

/**
 * e.g. "₹4,174 → ₹8,354 · 1 added (2 → 3 items)"
 *
 * Returns a non-empty string for any input: a row exists because something
 * changed, so an empty description would be a lie about the row's own
 * existence.
 */
export function describeOrderChange(input: OrderChangeSummaryInput): string {
  const parts: string[] = [];

  if (input.previousTotalPaise !== input.newTotalPaise) {
    parts.push(
      `${formatInrFromPaise(input.previousTotalPaise)} → ${formatInrFromPaise(input.newTotalPaise)}`,
    );
  }

  const itemBits: string[] = [];
  if (input.itemsAdded > 0) itemBits.push(`${input.itemsAdded} added`);
  if (input.itemsRemoved > 0) itemBits.push(`${input.itemsRemoved} removed`);
  if (input.itemsAmended > 0) itemBits.push(`${input.itemsAmended} changed`);

  if (itemBits.length > 0) {
    parts.push(
      `${itemBits.join(', ')} (${input.previousItemCount} → ${input.newItemCount} items)`,
    );
  }

  // Belt and braces: a row with no discernible delta should still read as
  // something rather than render a blank line in the timeline.
  if (parts.length === 0) return 'Edited in CartPlus';

  return parts.join(' · ');
}
