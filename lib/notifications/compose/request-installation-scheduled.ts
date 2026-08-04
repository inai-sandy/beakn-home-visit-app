// =============================================================================
// Composer for `request.installation_scheduled`
// =============================================================================
//
// In-app fan-out to the assigned exec, the owning city captain, and
// super_admins when an ORDER_CONFIRMED request is moved to
// INSTALLATION_SCHEDULED. Pure: reads the resolved context, no I/O.
// =============================================================================

import { formatInTimeZone } from 'date-fns-tz';

import { TIMEZONE } from '@/lib/date';

import type { InAppBody } from './request-assigned';

export interface InstallationScheduledContext {
  requestId: string;
  customerName: string;
  cityName?: string | null;
  /** HVA-319: ISO string supplied by lib/visit-schedule/actions.ts. Absent on
   *  requests scheduled before HVA-317 created the column. */
  installationScheduledAt?: string | null;
}

/** "12 Aug, 3:30 pm" in IST, or null when there is no usable date. */
function formatInstallationMoment(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return formatInTimeZone(d, TIMEZONE, 'd MMM, h:mm aaa');
}

export function composeInstallationScheduledInApp(
  ctx: InstallationScheduledContext,
): InAppBody {
  const where = ctx.cityName ? ` in ${ctx.cityName}` : '';
  // HVA-319: say WHEN. The old copy — "has moved to Installation Scheduled" —
  // told the reader a stage name they could already see, and there was no
  // date to state anyway until HVA-317 added the column. Falls back to the
  // original wording for requests scheduled before that.
  const when = formatInstallationMoment(ctx.installationScheduledAt);
  return {
    title: `Installation scheduled: ${ctx.customerName}`,
    body: when
      ? `Installation for ${ctx.customerName}${where} is set for ${when}.`
      : `${ctx.customerName}'s order${where} has moved to Installation Scheduled.`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}
