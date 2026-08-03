// =============================================================================
// HVA-240 (HVA-231 Phase 2 PR-C): composers for dispatch events
// =============================================================================
//
// Three event types:
//   support.order_ready_for_dispatch  → support team broadcast
//   support.dispatch_recorded         → exec + captain
//   support.dispatch_advanced         → exec + captain
//
// Each returns the InAppBody shape (title / body / linkUrl). WhatsApp
// composers below produce the (templateKey + components) shape the
// HVA-46 channel adapter expects. Templates ship `enabled=false` in
// notification_rules until Meta approves them; the engine's existing
// behaviour silently skips disabled rules.
// =============================================================================

export interface InAppBody {
  title: string;
  body: string;
  linkUrl: string;
}

function appUrl(): string {
  return (
    process.env.BETTER_AUTH_URL ??
    process.env.APP_URL ??
    'https://visits.beakn.in'
  ).replace(/\/+$/u, '');
}

// -----------------------------------------------------------------------------
// support.order_ready_for_dispatch — when a request transitions to ORDER_CONFIRMED
// -----------------------------------------------------------------------------

export interface OrderReadyForDispatchContext {
  requestId: string;
  customerName: string;
  cityName: string;
  itemCount: number;
}

export function composeOrderReadyForDispatchInApp(
  ctx: OrderReadyForDispatchContext,
): InAppBody {
  const itemsText =
    ctx.itemCount === 1 ? '1 item' : `${ctx.itemCount} items`;
  return {
    title: `Order ready for dispatch — ${ctx.customerName}`,
    body: `${itemsText} from ${ctx.cityName} are now in the dispatch queue.`,
    linkUrl: `${appUrl()}/support/orders/${ctx.requestId}`,
  };
}

// -----------------------------------------------------------------------------
// support.dispatch_recorded — when a dispatch event is created
// -----------------------------------------------------------------------------

export interface DispatchRecordedContext {
  requestId: string;
  dispatchId: string;
  customerName: string;
  dispatchedByName: string;
  itemSummary: string; // e.g. "3 of 5 KitchenLight, 1 of 1 CurtainMotor"
  totalItemsInDispatch: number;
}

export function composeDispatchRecordedInApp(
  ctx: DispatchRecordedContext,
): InAppBody {
  return {
    title: `Items dispatched for ${ctx.customerName}`,
    body: `${ctx.itemSummary}. Recorded by ${ctx.dispatchedByName}.`,
    linkUrl: `${appUrl()}/requests/${ctx.requestId}`,
  };
}

// -----------------------------------------------------------------------------
// support.dispatch_advanced — stage flipped (created → packed → handed_off)
// -----------------------------------------------------------------------------

/** HVA-304: 'delivered' joins the advanceable stages. It reuses the
 *  existing `support.dispatch_advanced` event rather than introducing a new
 *  event type — those rules are already enabled for exec + captain, so
 *  delivery notifications work with no notification_rules migration. */
export type AdvanceableDispatchStage = 'packed' | 'handed_off' | 'delivered';

export interface DispatchAdvancedContext {
  requestId: string;
  dispatchId: string;
  customerName: string;
  newStage: AdvanceableDispatchStage;
  changedByName: string;
}

const STAGE_HEADLINE: Record<
  AdvanceableDispatchStage,
  { title: string; body: (ctx: DispatchAdvancedContext) => string }
> = {
  packed: {
    title: 'Items packed',
    body: (ctx) =>
      `Dispatch for ${ctx.customerName} marked packed by ${ctx.changedByName}. Ready for handoff.`,
  },
  handed_off: {
    title: 'Items handed off',
    body: (ctx) =>
      `Dispatch for ${ctx.customerName} handed off by ${ctx.changedByName}. On its way to the customer.`,
  },
  delivered: {
    title: 'Items delivered',
    body: (ctx) =>
      `${ctx.customerName} has received this dispatch. Marked delivered by ${ctx.changedByName}.`,
  },
};

/** Human wording for the WhatsApp body parameter. Kept beside
 *  STAGE_HEADLINE so a new stage can't be added to one and missed in the
 *  other — the Record type forces both to be exhaustive. */
const WHATSAPP_STAGE_WORD: Record<AdvanceableDispatchStage, string> = {
  packed: 'packed',
  handed_off: 'handed off',
  delivered: 'delivered',
};

export function composeDispatchAdvancedInApp(
  ctx: DispatchAdvancedContext,
): InAppBody {
  const spec = STAGE_HEADLINE[ctx.newStage];
  return {
    title: `${spec.title} — ${ctx.customerName}`,
    body: spec.body(ctx),
    linkUrl: `${appUrl()}/requests/${ctx.requestId}`,
  };
}

// =============================================================================
// HVA-306: the WhatsApp composers that used to live here are gone.
// =============================================================================
//
// They were never registered in WHATSAPP_COMPOSERS and returned a shape the
// channel adapter does not accept ({ templateName, language: 'en' } rather
// than { name, language: { code } }), so nothing could ever have sent them.
// The real composers now live beside every other template in
// lib/notifications/compose/whatsapp-events.ts, keyed by template_key —
// which is how the adapter looks them up.
// =============================================================================
