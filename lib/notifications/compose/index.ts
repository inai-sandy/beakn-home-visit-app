// =============================================================================
// HVA-48: composer registry
// =============================================================================
//
// Maps (eventType, channel) → composer function. The engine calls into
// here to render the channel-specific body shape from the resolved
// context. Adding a new event:
//   1. Author per-channel composer functions in a new file at
//      lib/notifications/compose/<event-name>.ts.
//   2. Register them under the right channel key below.
//   3. The engine picks them up; no schema change needed.
// =============================================================================

import {
  composeRequestAssignedEmail,
  composeRequestAssignedInApp,
  type EmailBody,
  type InAppBody,
  type RequestAssignedContext,
} from './request-assigned';
import {
  composeRequestRolledBackInApp,
  type RequestRolledBackContext,
} from './request-rolled-back';

export type InAppComposer = (
  context: Record<string, unknown>,
) => InAppBody;

export type EmailComposer = (
  context: Record<string, unknown>,
) => EmailBody;

// Channel-specific composer maps. Lookup is by eventType. Missing entry
// = no composer registered = engine returns a `skipped` delivery for
// that (eventType, channel) tuple.
export const IN_APP_COMPOSERS: Record<string, InAppComposer> = {
  'request.assigned': (ctx) => composeRequestAssignedInApp(ctx as unknown as RequestAssignedContext),
  // HVA-141: captain in-app drawer when an exec / captain / admin rolls
  // a request back one stage.
  'request.rolled_back': (ctx) =>
    composeRequestRolledBackInApp(ctx as unknown as RequestRolledBackContext),
};

export const EMAIL_COMPOSERS: Record<string, EmailComposer> = {
  'request.assigned': (ctx) => composeRequestAssignedEmail(ctx as unknown as RequestAssignedContext),
};

// WhatsApp + Discord composers are stub-side: their adapters log the
// stub_invoked event without rendering bodies. When HVA-49 / HVA-43
// wire real providers, add per-event composers here in matching maps.
