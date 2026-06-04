// =============================================================================
// HVA-228: composers for exec.soft_warning_issued · exec.hard_warning_issued
//          · exec.warning_revoked · exec.fifth_hard_warning
// =============================================================================
//
// Soft + hard: target the exec themselves via in-app drawer and Web Push.
//   - title shows the kind
//   - body uses the message_snapshot prepared by the warnings action (so
//     in-app shows exactly the text recorded in the audit row).
//   - linkUrl points to /today (where the warning pill lives).
//
// Revoke: same target, gentle confirmation copy.
//
// Fifth hard warning: targets super_admin (Sandeep) as a self-alert so
// he sees the banner-trigger in his in-app drawer too.
// =============================================================================

import type { InAppBody } from './request-assigned';

const SHORT_PREVIEW_LEN = 160;

function shorten(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= SHORT_PREVIEW_LEN) return trimmed;
  return `${trimmed.slice(0, SHORT_PREVIEW_LEN - 1).trimEnd()}…`;
}

export interface ExecWarningContext {
  execUserId: string;
  execName: string;
  warningId: string;
  messageSnapshot: string;
  hardCount?: number;
  hardThreshold?: number;
}

export function composeSoftWarningInApp(ctx: ExecWarningContext): InAppBody {
  return {
    title: 'Performance check-in from Sandeep',
    body: shorten(ctx.messageSnapshot),
    linkUrl: '/today',
  };
}

export function composeHardWarningInApp(ctx: ExecWarningContext): InAppBody {
  const stamp =
    ctx.hardCount && ctx.hardThreshold
      ? ` (${ctx.hardCount}/${ctx.hardThreshold})`
      : '';
  return {
    title: `Formal performance notice${stamp}`,
    body: shorten(ctx.messageSnapshot),
    linkUrl: '/today',
  };
}

export interface ExecWarningRevokedContext {
  execUserId: string;
  warningId: string;
  kind: string;
  revokedReason: string;
}

export function composeWarningRevokedInApp(
  ctx: ExecWarningRevokedContext,
): InAppBody {
  const kindLabel = ctx.kind === 'hard' ? 'hard warning' : 'soft warning';
  return {
    title: `A ${kindLabel} on your record was revoked`,
    body: `Sandeep revoked the ${kindLabel}. Reason: ${shorten(ctx.revokedReason)}`,
    linkUrl: '/today',
  };
}

export interface ExecFifthHardWarningContext {
  execUserId: string;
  execName: string;
  warningId: string;
  hardThreshold: number;
}

export function composeFifthHardWarningForAdmin(
  ctx: ExecFifthHardWarningContext,
): InAppBody {
  return {
    title: `${ctx.execName} reached ${ctx.hardThreshold}/${ctx.hardThreshold} hard warnings`,
    body: `Eligible for termination — review and click Deactivate when ready.`,
    linkUrl: `/admin/settings/organization/executives/${ctx.execUserId}`,
  };
}
