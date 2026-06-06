import { hashPassword } from 'better-auth/crypto';
import { eq, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';

import { db } from '@/db/client';
import { accounts, users } from '@/db/schema';
import { requireSuperAdmin } from '@/lib/admin/auth-helper';
import { generateTempPassword } from '@/lib/admin/temp-password';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { supportUserCreateSchema } from '@/lib/validators/admin-users';

// =============================================================================
// HVA-236: POST /api/admin/support — create a support team user
// =============================================================================
//
// Mirrors POST /api/admin/executives but trimmed:
//   - No captain assignment (support is global pool)
//   - No city assignment
//   - No salesExecutives subtype row
//
// Validation:
//   1. Zod payload (fullName / phone / email-optional)
//   2. Phone uniqueness across all users
//   3. Email uniqueness if provided
//
// Execution (single tx):
//   - INSERT users (role='support', must_change_password=true)
//   - INSERT accounts row with scrypt-hashed temp password
//   - audit_log: 'support_user_created'
//
// Returns the user + the temp password (admin shows once + has to share
// with the support user out of band — same as executives).
// =============================================================================

export async function POST(req: Request): Promise<NextResponse> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const actor = guard.session.user as { id: string };

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = supportUserCreateSchema.safeParse(bodyRaw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return NextResponse.json(
      { ok: false, error: 'Some fields are invalid.', fieldErrors },
      { status: 400 },
    );
  }
  const { fullName, phone, email } = parsed.data;
  const phoneStorage = `+91${phone}`;

  const uniqMatch = email
    ? or(eq(users.phone, phoneStorage), eq(users.email, email))
    : eq(users.phone, phoneStorage);
  const conflicts = await db
    .select({ id: users.id, phone: users.phone, email: users.email })
    .from(users)
    .where(uniqMatch);
  if (conflicts.length > 0) {
    const phoneTaken = conflicts.some((c) => c.phone === phoneStorage);
    const emailTaken = email ? conflicts.some((c) => c.email === email) : false;
    return NextResponse.json(
      {
        ok: false,
        error: phoneTaken ? 'Phone number already in use.' : 'Email already in use.',
        fieldErrors: {
          ...(phoneTaken && { phone: 'Already in use' }),
          ...(emailTaken && { email: 'Already in use' }),
        },
      },
      { status: 409 },
    );
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  let createdId: string;
  try {
    createdId = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          role: USER_ROLES.SUPPORT,
          fullName,
          phone: phoneStorage,
          email: email ?? null,
          phoneVerified: false,
          isActive: true,
          mustChangePassword: true,
        })
        .returning({ id: users.id });
      await tx.insert(accounts).values({
        accountId: u.id,
        providerId: 'credential',
        userId: u.id,
        password: passwordHash,
      });
      return u.id;
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Service temporarily unavailable.' },
      { status: 503 },
    );
  }

  const reqHeaders = await headersFn();
  await logEvent({
    eventType: 'support_user_created',
    actorUserId: actor.id,
    actorRole: USER_ROLES.SUPER_ADMIN,
    targetEntityType: 'user',
    targetEntityId: createdId,
    afterState: {
      role: USER_ROLES.SUPPORT,
      fullName,
      phone: phoneStorage,
      email: email ?? null,
    },
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  revalidatePath('/', 'layout');

  return NextResponse.json(
    {
      ok: true,
      user: { id: createdId, fullName, phone: phoneStorage, email: email ?? null },
      tempPassword,
    },
    { status: 200 },
  );
}
