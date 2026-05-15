import { hashPassword } from 'better-auth/crypto';
import { eq, or } from 'drizzle-orm';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';

import { db } from '@/db/client';
import { accounts, salesExecutives, users } from '@/db/schema';
import { requireSuperAdmin } from '@/lib/admin/auth-helper';
import { generateTempPassword } from '@/lib/admin/temp-password';
import { logEvent } from '@/lib/audit';
import { executiveCreateSchema } from '@/lib/validators/admin-users';

// HVA-92: POST /api/admin/executives — create sales executive on captain's team
//
// VALIDATION:
//   1. Zod payload — name/phone/email/captainUserId
//   2. Phone uniqueness across users
//   3. Email uniqueness across users
//   4. Captain exists, role='captain', is_active=true
//
// EXECUTION (single tx):
//   - INSERT users (role='sales_executive', must_change_password=true)
//   - INSERT accounts row with scrypt-hashed temp password
//   - INSERT sales_executives subtype (user_id, captain_user_id)
//   - audit_log: 'executive_created'
//
// NOTE: schema has no city column on sales_executives. Exec serves ALL
// of captain's cities (design decision, documented).

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
  const parsed = executiveCreateSchema.safeParse(bodyRaw);
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
  const { fullName, phone, email, captainUserId } = parsed.data;
  const phoneStorage = `+91${phone}`;

  // Uniqueness. Email optional.
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

  // Captain validation
  const [cap] = await db
    .select({ id: users.id, role: users.role, isActive: users.isActive, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, captainUserId))
    .limit(1);
  if (!cap || cap.role !== 'captain') {
    return NextResponse.json(
      { ok: false, error: 'Captain not found.', fieldErrors: { captainUserId: 'Invalid captain' } },
      { status: 400 },
    );
  }
  if (!cap.isActive) {
    return NextResponse.json(
      { ok: false, error: 'Captain is inactive.', fieldErrors: { captainUserId: 'Captain inactive' } },
      { status: 400 },
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
          role: 'sales_executive',
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
      await tx.insert(salesExecutives).values({
        userId: u.id,
        captainUserId,
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
    eventType: 'executive_created',
    actorUserId: actor.id,
    actorRole: 'super_admin',
    targetEntityType: 'user',
    targetEntityId: createdId,
    afterState: {
      role: 'sales_executive',
      fullName,
      phone: phoneStorage,
      email: email ?? null,
      captainUserId,
      captainName: cap.fullName,
    },
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  return NextResponse.json(
    {
      ok: true,
      user: { id: createdId, fullName, phone: phoneStorage, email: email ?? null, captainUserId },
      tempPassword,
    },
    { status: 200 },
  );
}
