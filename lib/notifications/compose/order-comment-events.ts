import type { InAppBody } from './request-assigned';

// =============================================================================
// HVA-241 (HVA-231 Phase 3): order comment thread composer
// =============================================================================

export interface OrderCommentAddedContext {
  requestId: string;
  commentId: string;
  customerName: string;
  cityName: string;
  authorName: string | null;
  authorRole: string;
  bodyPreview: string;
  recipientRole?: string;
}

function roleLabel(role: string): string {
  switch (role) {
    case 'support':
      return 'Support';
    case 'sales_executive':
      return 'Exec';
    case 'captain':
      return 'Captain';
    case 'super_admin':
      return 'Admin';
    default:
      return 'Team';
  }
}

export function composeOrderCommentAddedInApp(
  ctx: OrderCommentAddedContext,
): InAppBody {
  const who = ctx.authorName ?? roleLabel(ctx.authorRole);
  const mentioned = ctx.recipientRole === 'mentioned_users';
  const title = mentioned
    ? `${who} mentioned you on ${ctx.customerName}'s order`
    : `${who} commented on ${ctx.customerName}'s order`;
  return {
    title,
    body: ctx.bodyPreview,
    linkUrl: `/support/orders/${ctx.requestId}`,
  };
}
