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
  composeRequestApprovedInApp,
  composeRequestRejectedInApp,
  type RequestApprovedContext,
  type RequestRejectedContext,
} from './request-approved';
import {
  composeRequestReassignedEmailCaptain,
  composeRequestReassignedInAppAssigned,
  composeRequestReassignedInAppRemoved,
  type RequestReassignedContext,
} from './request-reassigned';
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
  // HVA-140: in-app fan-out for captain reassigning the current exec.
  // Two rules seeded under the same event_type; the engine looks up
  // the composer per (eventType, channel) here. The rule's
  // recipient_role (exec_removed vs exec_assigned) only changes who
  // receives the SAME body — both composers below differ in copy so
  // we resolve the composer at lookup time based on the rule's
  // recipient_role. Since the registry is keyed on eventType alone,
  // we delegate to a thin selector via the role embedded in the
  // context. The engine sets `recipientRole` on the context just
  // before invoking the adapter; see HVA-140 engine patch for that.
  'request.reassigned': (ctx) => {
    const role =
      typeof ctx.recipientRole === 'string' ? ctx.recipientRole : '';
    if (role === 'exec_removed') {
      return composeRequestReassignedInAppRemoved(
        ctx as unknown as RequestReassignedContext,
      );
    }
    return composeRequestReassignedInAppAssigned(
      ctx as unknown as RequestReassignedContext,
    );
  },
  // HVA-137: captain approval gate — both events go to the assigned
  // exec via in-app drawer.
  'request.approved': (ctx) =>
    composeRequestApprovedInApp(ctx as unknown as RequestApprovedContext),
  'request.rejected': (ctx) =>
    composeRequestRejectedInApp(ctx as unknown as RequestRejectedContext),
};

export const EMAIL_COMPOSERS: Record<string, EmailComposer> = {
  'request.assigned': (ctx) => composeRequestAssignedEmail(ctx as unknown as RequestAssignedContext),
  // HVA-140: confirmation email to the captain who clicked Reassign.
  'request.reassigned': (ctx) =>
    composeRequestReassignedEmailCaptain(
      ctx as unknown as RequestReassignedContext,
    ),
};

// WhatsApp + Discord composers are stub-side: their adapters log the
// stub_invoked event without rendering bodies. When HVA-49 / HVA-43
// wire real providers, add per-event composers here in matching maps.
