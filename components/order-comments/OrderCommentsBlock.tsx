import { loadCommentsForRequest, loadMentionPool } from '@/lib/order-comments/queries';

import { OrderCommentsClient } from './OrderCommentsClient';

// =============================================================================
// HVA-241 (HVA-231 Phase 3): server-rendered comments block
// =============================================================================
//
// Loads timeline + mention pool, hands to the client component for thread
// rendering + composer + polling. Mount on /support/orders/[id] and on
// /requests/[id] for exec + captain.
// =============================================================================

interface Props {
  requestId: string;
  currentUserId: string;
}

export async function OrderCommentsBlock({ requestId, currentUserId }: Props) {
  const [comments, mentionPool] = await Promise.all([
    loadCommentsForRequest(requestId),
    loadMentionPool(requestId),
  ]);

  return (
    <OrderCommentsClient
      requestId={requestId}
      currentUserId={currentUserId}
      initialComments={comments.map((c) => ({
        id: c.id,
        body: c.body,
        parentCommentId: c.parentCommentId,
        createdAtIso: c.createdAt.toISOString(),
        authorUserId: c.authorUserId,
        authorName: c.authorName,
        authorRole: c.authorRole,
      }))}
      mentionPool={mentionPool.map((m) => ({
        id: m.id,
        fullName: m.fullName,
        role: m.role,
      }))}
    />
  );
}
