// 2026-05-30: composers for `request.created` (a customer submitted a new
// home-visit request via the public form).
//
// Captain audience: "you have a new request to assign". High signal — this
// is the captain's primary action queue trigger.
// Admin audience: org-wide visibility. Mild signal; admin can mute if noisy.

export interface RequestCreatedContext {
  requestId: string;
  customerName: string;
  cityName?: string | null;
  bhk?: string | null;
}

export interface InAppBody {
  title: string;
  body: string;
  linkUrl: string;
}

function bhkSuffix(bhk: string | null | undefined): string {
  if (!bhk || bhk.trim().length === 0) return '';
  return ` ${bhk.trim()}.`;
}

export function composeRequestCreatedForCaptain(
  ctx: RequestCreatedContext,
): InAppBody {
  const city = ctx.cityName ? ` in ${ctx.cityName}` : '';
  return {
    title: `New request: ${ctx.customerName}`,
    body: `Customer raised a visit request${city}.${bhkSuffix(ctx.bhk)} Assign an exec.`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}

export function composeRequestCreatedForAdmin(
  ctx: RequestCreatedContext,
): InAppBody {
  const city = ctx.cityName ? ` (${ctx.cityName})` : '';
  return {
    title: `New customer request: ${ctx.customerName}${city}`,
    body: `Public form submission.${bhkSuffix(ctx.bhk)}`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}
