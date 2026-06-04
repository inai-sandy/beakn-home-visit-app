'use server';

import { headers as headersFn } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getServerSession } from '@/lib/auth-server';
import { setConfig } from '@/lib/config';
import type { ConfigKey } from '@/lib/config-schema';

// =============================================================================
// HVA-224: shared "update one numeric config key" server action
// =============================================================================
//
// The three new workflow knobs (approval timeout / refund window / audit
// retention) are all single integers between 0 and a max. A shared
// action keeps each admin page to ~30 lines of UI without repeating the
// auth + revalidate boilerplate.
// =============================================================================

export type ActionResult = { ok: true } | { ok: false; error: string };

// Whitelist of keys this shared action will touch. Keeps the union
// tight; setConfig itself validates per the schema's `validation` block.
type AllowedKey = Extract<
  ConfigKey,
  | 'pending_captain_approval_timeout_hours'
  | 'refund_window_days'
  | 'audit_log_retention_months'
>;

const schema = z.object({
  key: z.enum([
    'pending_captain_approval_timeout_hours',
    'refund_window_days',
    'audit_log_retention_months',
  ]),
  value: z.number().int().min(0).max(3650),
});

export async function setNumericWorkflowConfigAction(
  input: z.infer<typeof schema>,
): Promise<ActionResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') return { ok: false, error: 'Forbidden' };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const headers = await headersFn();
  const ipAddress =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = headers.get('user-agent') ?? null;

  try {
    await setConfig(parsed.data.key as AllowedKey, parsed.data.value, {
      userId: user.id,
      role: 'super_admin',
      ipAddress,
      userAgent,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to save',
    };
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}
