// Composers for `request.rescheduled`. Customer-initiated reschedules from
// /track/[token] (HVA-72) and exec-initiated reschedules both dispatch this
// event. Captain + admin variants here so both audiences get visibility.

export interface RequestRescheduledContext {
  requestId: string;
  customerName: string;
  cityName?: string | null;
  toVisitScheduledAt: string;
  reason?: string | null;
}

export interface InAppBody {
  title: string;
  body: string;
  linkUrl: string;
}

function formatIstWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function reasonSuffix(reason: string | null | undefined): string {
  if (!reason) return '';
  const trimmed = reason.trim();
  if (trimmed.length === 0) return '';
  return ` Reason: ${trimmed}.`;
}

export function composeRequestRescheduledForCaptain(
  ctx: RequestRescheduledContext,
): InAppBody {
  const when = formatIstWhen(ctx.toVisitScheduledAt);
  const reason = reasonSuffix(ctx.reason);
  const city = ctx.cityName ? ` in ${ctx.cityName}` : '';
  return {
    title: `Visit rescheduled: ${ctx.customerName}`,
    body: `Moved to ${when}${city}.${reason}`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}

export function composeRequestRescheduledForAdmin(
  ctx: RequestRescheduledContext,
): InAppBody {
  const when = formatIstWhen(ctx.toVisitScheduledAt);
  const reason = reasonSuffix(ctx.reason);
  const city = ctx.cityName ? ` (${ctx.cityName})` : '';
  return {
    title: `Reschedule: ${ctx.customerName}${city}`,
    body: `New visit time: ${when}.${reason}`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}
