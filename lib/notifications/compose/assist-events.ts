// HVA-199: composers for the assist domain. Five events; per-recipient
// variants where the audience changes the framing.
//
// Single file because the bodies are short and share helper formatters.
// Split per file later if any body grows beyond a few lines.

import type {
  AssistPriority,
  AssistStatus,
} from '@/lib/assist/types';
import { ASSIST_PRIORITY_LABELS } from '@/lib/assist/types';

export interface AssistCreatedContext {
  assistId: string;
  itemCount: number;
  priority: AssistPriority;
  orderNumber?: string | null;
}

export interface AssistStatusChangeContext {
  assistId: string;
  fromStatus: AssistStatus;
  toStatus: AssistStatus;
  reason?: string | null;
}

export interface InAppBody {
  title: string;
  body: string;
  linkUrl: string;
}

function captainAssistLink(assistId: string): string {
  return `/captain/assist/${assistId}`;
}

function adminAssistLink(assistId: string): string {
  return `/admin/operations/assist/${assistId}`;
}

function execAssistLink(assistId: string): string {
  return `/assist/${assistId}`;
}

function itemCountPhrase(count: number): string {
  if (count === 0) return 'no items specified';
  if (count === 1) return '1 item';
  return `${count} items`;
}

function reasonSuffix(reason: string | null | undefined): string {
  if (!reason) return '';
  const trimmed = reason.trim();
  if (trimmed.length === 0) return '';
  return ` Reason: ${trimmed}.`;
}

// ---------------------------------------------------------------------------
// assist.created (captain + admin variants)
// ---------------------------------------------------------------------------

export function composeAssistCreatedForCaptain(
  ctx: AssistCreatedContext,
): InAppBody {
  const order = ctx.orderNumber ? ` for order ${ctx.orderNumber}` : '';
  return {
    title: `New assist request: ${ASSIST_PRIORITY_LABELS[ctx.priority]} priority`,
    body: `Your exec submitted an assist${order} (${itemCountPhrase(ctx.itemCount)}).`,
    linkUrl: captainAssistLink(ctx.assistId),
  };
}

export function composeAssistCreatedForAdmin(
  ctx: AssistCreatedContext,
): InAppBody {
  const order = ctx.orderNumber ? ` (order ${ctx.orderNumber})` : '';
  return {
    title: `Assist request: ${ASSIST_PRIORITY_LABELS[ctx.priority]}${order}`,
    body: `New material-request assist (${itemCountPhrase(ctx.itemCount)}).`,
    linkUrl: adminAssistLink(ctx.assistId),
  };
}

// ---------------------------------------------------------------------------
// assist.approved (exec + admin variants)
// ---------------------------------------------------------------------------

export function composeAssistApprovedForExec(
  ctx: AssistStatusChangeContext,
): InAppBody {
  return {
    title: 'Assist approved',
    body: `Your assist request has been approved and is being arranged.${reasonSuffix(ctx.reason)}`,
    linkUrl: execAssistLink(ctx.assistId),
  };
}

export function composeAssistApprovedForAdmin(
  ctx: AssistStatusChangeContext,
): InAppBody {
  return {
    title: 'Assist approved',
    body: `Captain approved the assist.${reasonSuffix(ctx.reason)}`,
    linkUrl: adminAssistLink(ctx.assistId),
  };
}

// ---------------------------------------------------------------------------
// assist.processing
// ---------------------------------------------------------------------------

export function composeAssistProcessingForExec(
  ctx: AssistStatusChangeContext,
): InAppBody {
  return {
    title: 'Assist in process',
    body: `Your assist request is being processed for dispatch.${reasonSuffix(ctx.reason)}`,
    linkUrl: execAssistLink(ctx.assistId),
  };
}

export function composeAssistProcessingForAdmin(
  ctx: AssistStatusChangeContext,
): InAppBody {
  return {
    title: 'Assist in process',
    body: `Assist moved to processing.${reasonSuffix(ctx.reason)}`,
    linkUrl: adminAssistLink(ctx.assistId),
  };
}

// ---------------------------------------------------------------------------
// assist.dispatched
// ---------------------------------------------------------------------------

export function composeAssistDispatchedForExec(
  ctx: AssistStatusChangeContext,
): InAppBody {
  return {
    title: 'Assist dispatched',
    body: `Your material request has been dispatched.${reasonSuffix(ctx.reason)}`,
    linkUrl: execAssistLink(ctx.assistId),
  };
}

export function composeAssistDispatchedForAdmin(
  ctx: AssistStatusChangeContext,
): InAppBody {
  return {
    title: 'Assist dispatched',
    body: `Captain marked assist as dispatched.${reasonSuffix(ctx.reason)}`,
    linkUrl: adminAssistLink(ctx.assistId),
  };
}

// ---------------------------------------------------------------------------
// assist.rejected
// ---------------------------------------------------------------------------

export function composeAssistRejectedForExec(
  ctx: AssistStatusChangeContext,
): InAppBody {
  return {
    title: 'Assist rejected',
    body: `Your assist request was rejected.${reasonSuffix(ctx.reason)}`,
    linkUrl: execAssistLink(ctx.assistId),
  };
}

export function composeAssistRejectedForAdmin(
  ctx: AssistStatusChangeContext,
): InAppBody {
  return {
    title: 'Assist rejected',
    body: `Captain rejected an assist.${reasonSuffix(ctx.reason)}`,
    linkUrl: adminAssistLink(ctx.assistId),
  };
}
