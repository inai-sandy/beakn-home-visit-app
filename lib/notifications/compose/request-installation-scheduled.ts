// =============================================================================
// Composer for `request.installation_scheduled`
// =============================================================================
//
// In-app fan-out to the assigned exec, the owning city captain, and
// super_admins when an ORDER_CONFIRMED request is moved to
// INSTALLATION_SCHEDULED. Pure: reads the resolved context, no I/O.
// =============================================================================

import type { InAppBody } from './request-assigned';

export interface InstallationScheduledContext {
  requestId: string;
  customerName: string;
  cityName?: string | null;
}

export function composeInstallationScheduledInApp(
  ctx: InstallationScheduledContext,
): InAppBody {
  const where = ctx.cityName ? ` in ${ctx.cityName}` : '';
  return {
    title: `Installation scheduled: ${ctx.customerName}`,
    body: `${ctx.customerName}'s order${where} has moved to Installation Scheduled.`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}
