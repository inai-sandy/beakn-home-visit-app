// =============================================================================
// HVA-324 / HVA-325: the request timeline is ONE chronological story
// =============================================================================
//
// Sandeep, looking at request 019ebacb on 2026-08-04: "see the overall
// activity and how the activity is fluctuating… the order is not right. You
// can see the total flow of the order."
//
// The page had rendered status history and reschedule history as two
// CONCATENATED lists, so June reschedules printed below an August completion
// with the current-stage marker stranded mid-list. HVA-324 merged and sorted
// them; HVA-325 adds a third source (CartPlus order edits).
//
// The sort lives here rather than inline in the server component because the
// HVA-324 test had to MIRROR the inline version to test it — two copies of
// the ordering rule with nothing forcing them to agree, which is the same
// class of bug this batch has been closing all week. Now the page and the
// test use the one function.
// =============================================================================

/**
 * HVA-332: a cancellation is not a stage transition.
 *
 * `apply-status.ts` records a cancellation as a `from = to` row — the stage
 * does not move, only a reason is attached (`CANCELLED_BY_CUSTOMER: …`).
 * Every timeline labels a row by its TO-stage, so those rows rendered as a
 * duplicate of whatever stage the request was sitting at, directly above the
 * real "Cancelled" entry. The customer saw:
 *
 *     Quotation Given    28 days ago
 *     Order Confirmed    28 days ago
 *     Order Confirmed    28 days ago   <- the cancellation
 *     Cancelled          28 days ago
 *
 * Reproduced at a different stage (cancelled at Visit Scheduled produced a
 * duplicate "Visit Scheduled"), so it is general to every cancellation, not
 * specific to the CartPlus path.
 *
 * Filter on the structural fact rather than on the reason prefix: a row whose
 * from and to are the same stage did not move the request, so it is never a
 * stage event, whatever wrote it. Matching on the `CANCELLED_BY_CUSTOMER:`
 * string would miss the next writer that adopts the same shape — and
 * HVA-325's note records that `apply-status.ts` "sets that precedent".
 *
 * Rows with no from-stage (the very first transition) are kept: those are
 * real, and `fromStageId` is null rather than equal.
 */
export function isStageTransition(row: {
  fromStageId: string | null;
  toStageId: string;
}): boolean {
  return row.fromStageId === null || row.fromStageId !== row.toStageId;
}

export type TimelineEventKind = 'status' | 'reschedule' | 'order_change';

/**
 * Tie-break order for events stamped the same instant.
 *
 * A status change reads first and the others amend it: a reschedule always
 * amends a scheduling, and an order edit arriving with a stage change is a
 * consequence of it. Otherwise the story runs backwards within a second.
 *
 * An explicit rank, not a two-way comparison — with three kinds, "not
 * status" stopped being a single answer.
 */
export const TIMELINE_KIND_RANK: Record<TimelineEventKind, number> = {
  status: 0,
  order_change: 1,
  reschedule: 2,
};

export interface SortableTimelineEvent {
  kind: TimelineEventKind;
  when: Date;
}

/**
 * Merge every source into one non-decreasing sequence.
 *
 * Does NOT touch `isCurrent`: that stays keyed off the status ladder, not
 * list position, because a reschedule or an order edit can be the most RECENT
 * event while the current STAGE is an earlier row. Sorting alone would move
 * the marker to the wrong line.
 */
export function sortTimelineEvents<T extends SortableTimelineEvent>(
  events: readonly T[],
): T[] {
  return [...events].sort((a, b) => {
    const diff = a.when.getTime() - b.when.getTime();
    if (diff !== 0) return diff;
    return TIMELINE_KIND_RANK[a.kind] - TIMELINE_KIND_RANK[b.kind];
  });
}
