// =============================================================================
// HVA-228 + HVA-229: composers for exec warnings
// =============================================================================
//
// Soft + hard: target the exec themselves via in-app drawer and Web Push.
//   - title shows the kind
//   - body stores the FULL message_snapshot text (the drawer line-clamps
//     visually for the list view; the click-popup reads the same field
//     and shows it in full). HVA-229: previously truncated to 160 chars
//     which broke the popup — Sandeep: "I couldn't see complete message
//     in popup. the only reason I need popup is to see full message."
//   - linkUrl points to /today (where the warning pill lives).
//
// Revoke: same target, gentle confirmation copy.
//
// Fifth hard warning: targets super_admin (Sandeep) as a self-alert so
// he sees the banner-trigger in his in-app drawer too.
// =============================================================================

import type { InAppBody } from './request-assigned';

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
    body: ctx.messageSnapshot.trim(),
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
    body: ctx.messageSnapshot.trim(),
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
    body: `Sandeep revoked the ${kindLabel}.\n\nReason: ${ctx.revokedReason.trim()}`,
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
