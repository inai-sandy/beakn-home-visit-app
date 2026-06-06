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

export interface DispatchAdvancedContext {
  requestId: string;
  dispatchId: string;
  customerName: string;
  newStage: 'packed' | 'handed_off';
  changedByName: string;
}

const STAGE_HEADLINE: Record<
  'packed' | 'handed_off',
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
// WhatsApp templates (UTILITY; submitted to Meta separately)
// =============================================================================
//
// Each returns the template_key + components per the HVA-45/46 Libromi
// API contract. Templates ship `enabled=false` in notification_rules
// until Meta approves them. Body templates below match what we'll
// submit to Meta — keep them in sync.
// =============================================================================

export interface WhatsAppComponent {
  type: 'body';
  parameters: Array<{ type: 'text'; text: string }>;
}

export interface WhatsAppMessage {
  templateName: string;
  language: string;
  components: WhatsAppComponent[];
}

// Template body submitted to Meta:
//   "Hi {{1}}, items dispatched for {{2}} ({{3}} units). Recorded by {{4}}.
//    Open: https://visits.beakn.in/requests/{{5}}"
export function composeDispatchRecordedWhatsApp(
  ctx: DispatchRecordedContext,
  recipientName: string,
): WhatsAppMessage {
  return {
    templateName: 'internal_items_dispatched_v1',
    language: 'en',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: recipientName },
          { type: 'text', text: ctx.customerName },
          { type: 'text', text: String(ctx.totalItemsInDispatch) },
          { type: 'text', text: ctx.dispatchedByName },
          { type: 'text', text: ctx.requestId },
        ],
      },
    ],
  };
}

// Template body submitted to Meta:
//   "Hi {{1}}, dispatch for {{2}} is now {{3}} (updated by {{4}}).
//    Open: https://visits.beakn.in/requests/{{5}}"
export function composeDispatchAdvancedWhatsApp(
  ctx: DispatchAdvancedContext,
  recipientName: string,
): WhatsAppMessage {
  return {
    templateName: 'internal_dispatch_advanced_v1',
    language: 'en',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: recipientName },
          { type: 'text', text: ctx.customerName },
          { type: 'text', text: ctx.newStage === 'packed' ? 'packed' : 'handed off' },
          { type: 'text', text: ctx.changedByName },
          { type: 'text', text: ctx.requestId },
        ],
      },
    ],
  };
}
