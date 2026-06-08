'use server';

import { randomBytes } from 'crypto';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import { cities, users, webhookSecrets } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { getServerSession } from '@/lib/auth-server';

// =============================================================================
// HVA-248 (HVA-230): CartPlus integration server actions
// =============================================================================
//
// All super_admin-gated. Universal ActionResult shape per HVA action
// contract (no throws). Each mutation writes an audit event from the new
// HVA-248 allow-list entries (webhook_secret_generated /
// webhook_secret_revoked / cartplus_city_mapping_updated /
// cartplus_exec_mapping_updated).
// =============================================================================

const PROVIDER_CARTPLUS = 'cartplus';

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function requireSuperAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') return { ok: false, error: 'Forbidden' };
  return { ok: true, userId: user.id };
}

function previewOf(secret: string): string {
  if (secret.length <= 8) return secret;
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

// -----------------------------------------------------------------------------
// Generate new secret — auto-revokes previously active secrets
// -----------------------------------------------------------------------------

export async function generateCartplusSecretAction(): Promise<
  ActionResult<{ secret: string; preview: string }>
> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth;

  // 32 bytes = 64 hex chars — plenty for HMAC-SHA256
  const secret = randomBytes(32).toString('hex');
  const preview = previewOf(secret);

  await db.transaction(async (tx) => {
    // Soft-revoke any currently-active secret first so we maintain the
    // "at most one active secret per provider" invariant.
    await tx
      .update(webhookSecrets)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(webhookSecrets.provider, PROVIDER_CARTPLUS),
          isNull(webhookSecrets.revokedAt),
        ),
      );

    const [created] = await tx
      .insert(webhookSecrets)
      .values({
        provider: PROVIDER_CARTPLUS,
        secret,
        secretPreview: preview,
        createdByUserId: auth.userId,
      })
      .returning({ id: webhookSecrets.id });

    await logEvent({
      eventType: 'webhook_secret_generated',
      actorUserId: auth.userId,
      targetEntityType: 'webhook_secret',
      targetEntityId: created.id,
      afterState: {
        provider: PROVIDER_CARTPLUS,
        preview,
      },
    });
  });

  revalidatePath('/', 'layout');
  return { ok: true, data: { secret, preview } };
}

// -----------------------------------------------------------------------------
// Revoke a specific secret (manual revoke)
// -----------------------------------------------------------------------------

const revokeSchema = z.object({
  id: z.string().uuid(),
});

export async function revokeCartplusSecretAction(
  input: z.infer<typeof revokeSchema>,
): Promise<ActionResult> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input' };

  const [before] = await db
    .select({
      id: webhookSecrets.id,
      preview: webhookSecrets.secretPreview,
      revokedAt: webhookSecrets.revokedAt,
    })
    .from(webhookSecrets)
    .where(eq(webhookSecrets.id, parsed.data.id))
    .limit(1);

  if (!before) return { ok: false, error: 'Secret not found' };
  if (before.revokedAt) return { ok: false, error: 'Already revoked' };

  await db
    .update(webhookSecrets)
    .set({ revokedAt: new Date() })
    .where(eq(webhookSecrets.id, parsed.data.id));

  await logEvent({
    eventType: 'webhook_secret_revoked',
    actorUserId: auth.userId,
    targetEntityType: 'webhook_secret',
    targetEntityId: before.id,
    beforeState: { preview: before.preview, revokedAt: null },
    afterState: { preview: before.preview, revokedAt: new Date().toISOString() },
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}

// -----------------------------------------------------------------------------
// City ↔ store_id mapping
// -----------------------------------------------------------------------------

const cityMapSchema = z.object({
  cityId: z.string().uuid(),
  // null = clear the mapping
  cartplusStoreId: z.number().int().positive().nullable(),
});

export async function updateCartplusCityMappingAction(
  input: z.infer<typeof cityMapSchema>,
): Promise<ActionResult> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = cityMapSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input' };

  const [before] = await db
    .select({
      id: cities.id,
      name: cities.name,
      cartplusStoreId: cities.cartplusStoreId,
    })
    .from(cities)
    .where(eq(cities.id, parsed.data.cityId))
    .limit(1);

  if (!before) return { ok: false, error: 'City not found' };
  if (before.cartplusStoreId === parsed.data.cartplusStoreId) {
    return { ok: true }; // no-op
  }

  try {
    await db
      .update(cities)
      .set({
        cartplusStoreId: parsed.data.cartplusStoreId,
        updatedAt: new Date(),
      })
      .where(eq(cities.id, parsed.data.cityId));
  } catch (err) {
    // Postgres unique-violation surfaces from the partial unique index
    if (err instanceof Error && err.message.includes('unique')) {
      return {
        ok: false,
        error: 'Another city is already mapped to that CartPlus store ID',
      };
    }
    return { ok: false, error: 'Database error' };
  }

  await logEvent({
    eventType: 'cartplus_city_mapping_updated',
    actorUserId: auth.userId,
    targetEntityType: 'city',
    targetEntityId: before.id,
    beforeState: {
      city: before.name,
      cartplusStoreId: before.cartplusStoreId,
    },
    afterState: {
      city: before.name,
      cartplusStoreId: parsed.data.cartplusStoreId,
    },
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}

// -----------------------------------------------------------------------------
// User ↔ portal_exec_id mapping
// -----------------------------------------------------------------------------

const execMapSchema = z.object({
  userId: z.string().uuid(),
  portalExecId: z.number().int().positive().nullable(),
});

export async function updateCartplusExecMappingAction(
  input: z.infer<typeof execMapSchema>,
): Promise<ActionResult> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = execMapSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input' };

  const [before] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      role: users.role,
      portalExecId: users.portalExecId,
    })
    .from(users)
    .where(eq(users.id, parsed.data.userId))
    .limit(1);

  if (!before) return { ok: false, error: 'User not found' };
  if (before.role !== 'sales_executive' && before.role !== 'captain') {
    return { ok: false, error: 'Only sales executives and captains can be mapped' };
  }
  if (before.portalExecId === parsed.data.portalExecId) {
    return { ok: true };
  }

  try {
    await db
      .update(users)
      .set({
        portalExecId: parsed.data.portalExecId,
        updatedAt: new Date(),
      })
      .where(eq(users.id, parsed.data.userId));
  } catch (err) {
    if (err instanceof Error && err.message.includes('unique')) {
      return {
        ok: false,
        error: 'Another user is already mapped to that CartPlus exec ID',
      };
    }
    return { ok: false, error: 'Database error' };
  }

  await logEvent({
    eventType: 'cartplus_exec_mapping_updated',
    actorUserId: auth.userId,
    targetEntityType: 'user',
    targetEntityId: before.id,
    beforeState: {
      user: before.fullName,
      portalExecId: before.portalExecId,
    },
    afterState: {
      user: before.fullName,
      portalExecId: parsed.data.portalExecId,
    },
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}
