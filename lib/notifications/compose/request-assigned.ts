// =============================================================================
// HVA-48: composers for `request.assigned`
// =============================================================================
//
// Per-channel body composers. The engine looks them up via the channel
// + eventType map in lib/notifications/compose/index.ts. Returning a
// channel-shaped object (in-app: title/body/linkUrl; email: subject/
// bodyText/bodyHtml) keeps the adapter typing clean — the engine never
// crosses channel boundaries with the wrong fields.
//
// Composers are pure: no DB access, no I/O. The engine passes the
// resolved context map; composers read fields. Missing optional fields
// (e.g. `note`) gracefully degrade — no template engine, just plain
// string concat.
// =============================================================================

export interface RequestAssignedContext {
  requestId: string;
  customerName: string;
  cityName: string;
  execUserId: string;
  execName: string;
  captainUserId: string;
  captainName: string;
  /** Captain's optional free-text assignment note. May be undefined or empty. */
  note?: string | null;
}

export interface InAppBody {
  title: string;
  body: string;
  linkUrl: string;
}

export interface EmailBody {
  subject: string;
  bodyText: string;
  bodyHtml: string;
}

function appUrl(): string {
  // Mirrors the captain-new-request handler's fallback (HVA-42).
  return (
    process.env.BETTER_AUTH_URL ??
    process.env.APP_URL ??
    'https://visits.beakn.in'
  ).replace(/\/+$/u, '');
}

function noteSuffix(note: string | null | undefined, prefix: string): string {
  if (!note) return '';
  const trimmed = note.trim();
  if (trimmed.length === 0) return '';
  return `${prefix}${trimmed}`;
}

export function composeRequestAssignedInApp(
  ctx: RequestAssignedContext,
): InAppBody {
  const note = noteSuffix(ctx.note, ' Note: ');
  return {
    title: `New request assigned: ${ctx.customerName}`,
    body: `${ctx.captainName} assigned you a visit in ${ctx.cityName}.${note}`,
    // Mobile exec shell renders /requests/[id] at the role-agnostic path
    // (HVA-66). Same URL the assign-confirmation email uses below.
    linkUrl: `/requests/${ctx.requestId}`,
  };
}

export function composeRequestAssignedEmail(
  ctx: RequestAssignedContext,
): EmailBody {
  const url = `${appUrl()}/requests/${ctx.requestId}`;
  const note = noteSuffix(ctx.note, '\n\nYour note: ');
  const subject = `Assigned: ${ctx.customerName} — ${ctx.cityName}`;
  const bodyText = `You assigned ${ctx.execName} to handle ${ctx.customerName}'s visit in ${ctx.cityName}.${note}\n\nView request: ${url}`;
  // Minimal inline-styled HTML wrapper. Mirror lib/email-templates style.
  const escaped = (s: string): string =>
    s
      .replace(/&/gu, '&amp;')
      .replace(/</gu, '&lt;')
      .replace(/>/gu, '&gt;')
      .replace(/"/gu, '&quot;');
  const noteHtml = ctx.note && ctx.note.trim().length > 0
    ? `<p style="margin:0 0 12px 0;color:#374151"><strong>Your note:</strong> ${escaped(ctx.note.trim())}</p>`
    : '';
  const bodyHtml = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;max-width:560px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;margin:0 0 16px 0;">Assignment confirmed</h1>
  <p style="margin:0 0 12px 0;">You assigned <strong>${escaped(ctx.execName)}</strong> to handle <strong>${escaped(ctx.customerName)}</strong>'s visit in <strong>${escaped(ctx.cityName)}</strong>.</p>
  ${noteHtml}
  <p style="margin:24px 0 0 0;"><a href="${escaped(url)}" style="display:inline-block;padding:10px 18px;background:#0f766e;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">View request</a></p>
</body></html>`;
  return { subject, bodyText, bodyHtml };
}
