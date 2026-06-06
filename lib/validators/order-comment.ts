import { z } from 'zod';

// HVA-241 (HVA-231 Phase 3): order comment validator

export const ORDER_COMMENT_MAX_BODY = 2000;

export const addOrderCommentSchema = z.object({
  requestId: z.string().uuid('Invalid request id'),
  parentCommentId: z
    .string()
    .uuid('Invalid parent comment id')
    .nullable()
    .optional(),
  body: z
    .string()
    .trim()
    .min(1, 'Comment cannot be empty')
    .max(ORDER_COMMENT_MAX_BODY, `Comment must be at most ${ORDER_COMMENT_MAX_BODY} characters`),
  mentionedUserIds: z.array(z.string().uuid()).default([]),
});

export type AddOrderCommentInput = z.input<typeof addOrderCommentSchema>;
