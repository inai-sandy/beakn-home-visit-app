// =============================================================================
// HVA-140: composers for `request.reassigned`
// =============================================================================
//
// Three channels seeded for this event:
//   * in_app → exec_removed   (the exec being taken off)
//   * in_app → exec_assigned  (the new exec taking over)
//   * email  → captain_acting (the captain who clicked Reassign — confirmation)
//
// Composers are pure: no DB access. The engine passes the resolved
// context map; these functions read fields. Reason is mandatory at the
// validator level (50-500 chars), so the composers can assume it's
// present + non-empty.
// =============================================================================

import type { EmailBody, InAppBody } from './request-assigned';

export interface RequestReassignedContext {
  requestId: string;
  customerName: string;
  cityName: string;
  oldExecUserId: string;
  oldExecName: string;
  newExecUserId: string;
  newExecName: string;
  /** The captain (or super_admin) who clicked Reassign. */
  captainUserId: string;
  captainName: string;
  /** Mandatory free-text reason (50-500 chars). */
  reason: string;
}

function appUrl(): string {
  return (
    process.env.BETTER_AUTH_URL ??
    process.env.APP_URL ??
    'https://visits.beakn.in'
  ).replace(/\/+$/u, '');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

/**
 * In-app drawer for the exec who has just been taken off the request.
 * `linkUrl` is null — the removed exec no longer has access to the
 * request detail page (page-level authz gates `assigned_exec_user_id`
 * against the actor id).
 */
export function composeRequestReassignedInAppRemoved(
  ctx: RequestReassignedContext,
): InAppBody {
  return {
    title: `Removed from ${ctx.customerName}'s visit`,
    body: `${ctx.captainName} reassigned this visit in ${ctx.cityName} to ${ctx.newExecName}. Reason: ${ctx.reason}`,
    linkUrl: '',
  };
}

/**
 * In-app drawer for the new exec receiving the handoff. Captain's reason
 * is forwarded verbatim — the new exec sees the "why" so they can pick
 * up where the previous exec left off.
 */
export function composeRequestReassignedInAppAssigned(
  ctx: RequestReassignedContext,
): InAppBody {
  return {
    title: `Assigned to ${ctx.customerName}'s visit`,
    body: `Reassigned from ${ctx.oldExecName} in ${ctx.cityName}. Captain's note: ${ctx.reason}`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}

/**
 * Confirmation email to the captain who clicked Reassign. Carries both
 * exec names + the captain's own reason for the paper trail.
 */
export function composeRequestReassignedEmailCaptain(
  ctx: RequestReassignedContext,
): EmailBody {
  const url = `${appUrl()}/requests/${ctx.requestId}`;
  const subject = `Reassigned ${ctx.customerName} from ${ctx.oldExecName} to ${ctx.newExecName}`;
  const bodyText = [
    `You reassigned ${ctx.customerName}'s visit in ${ctx.cityName}.`,
    `Previous exec: ${ctx.oldExecName}`,
    `New exec: ${ctx.newExecName}`,
    `Reason: ${ctx.reason}`,
    ``,
    `View request: ${url}`,
  ].join('\n');
  const bodyHtml = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;max-width:560px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;margin:0 0 16px 0;">Reassignment confirmed</h1>
  <p style="margin:0 0 12px 0;">You reassigned <strong>${escapeHtml(ctx.customerName)}</strong>'s visit in <strong>${escapeHtml(ctx.cityName)}</strong>.</p>
  <dl style="margin:0 0 16px 0;color:#374151;">
    <dt style="display:inline-block;width:120px;color:#6b7280;">Previous exec:</dt><dd style="display:inline;margin:0;">${escapeHtml(ctx.oldExecName)}</dd><br/>
    <dt style="display:inline-block;width:120px;color:#6b7280;">New exec:</dt><dd style="display:inline;margin:0;">${escapeHtml(ctx.newExecName)}</dd><br/>
    <dt style="display:inline-block;width:120px;color:#6b7280;">Reason:</dt><dd style="display:inline;margin:0;">${escapeHtml(ctx.reason)}</dd>
  </dl>
  <p style="margin:24px 0 0 0;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;background:#0f766e;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">View request</a></p>
</body></html>`;
  return { subject, bodyText, bodyHtml };
}
