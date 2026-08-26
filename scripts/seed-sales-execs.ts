// Create or update sales executives and issue their first-login credentials.
//
// HVA-349. The sibling of `seed-captains.ts` and deliberately the same shape:
// roster from the environment so phone numbers stay out of `git log`, temp
// passwords to a chmod 600 file rather than stdout, idempotent re-runs, and a
// DRY_RUN that reports the plan truthfully.
//
// WHY A CAPTAIN IS REQUIRED. `sales_executives.captain_user_id` is NOT NULL
// with ON DELETE RESTRICT — an executive cannot exist without one. Rather than
// ask for it in the roster, it is derived from the executive's city via
// `cities.captain_user_id`, which HVA-348 populated. That keeps one source of
// truth: move a city to a new captain and the executives follow.
//
// A city with no captain therefore fails loudly. It has to: a silently
// captain-less executive would mean approvals with nobody to approve them.
//
//   SALES_EXECS_JSON='[{"name":"Asha","phone":"9876543210","city":"Pune"}]' \
//   EXEC_SECRETS_OUT=/home/beakn/exec-temp-passwords.txt \
//   DATABASE_URL=postgresql://beakn_app:PW@127.0.0.1:5432/beakn_app \
//     pnpm tsx scripts/seed-sales-execs.ts
//
// Add DRY_RUN=1 to print the plan and change nothing.
//
// Idempotent. An executive who already exists keeps their password — only a
// genuinely new user gets one minted. Re-running after a city move is a no-op
// beyond the move itself.

import { randomBytes } from 'node:crypto';
import { chmodSync, writeFileSync } from 'node:fs';

import { hashPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { accounts } from '../db/schema/accounts';
import { users } from '../db/schema/auth';
import { cities, salesExecutives } from '../db/schema/org';

interface ExecSpec {
  name: string;
  phone: string;
  city: string;
  email?: string;
  /**
   * The CartPlus "employee id". Stored on `users.portal_exec_id`, which is how
   * the order webhook turns `created_by.id` into one of our users. Without it
   * every order this person raises in CartPlus resolves to
   * `unmapped_portal_exec_id` and arrives unassigned.
   */
  portalExecId?: number;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(
      `${name} is not set. This script takes its roster from the environment so\n` +
        'phone numbers never reach the repository. See the header for the shape.',
    );
  }
  return v;
}

/**
 * Storage convention across this codebase is '+91' + 10 digits — the same rule
 * `lib/phone.ts` enforces. Getting this wrong produces a row that looks correct
 * and a WhatsApp that never arrives, so it fails loudly instead.
 */
function toStoragePhone(input: string): string {
  const digits = String(input).replace(/\D/gu, '');
  let n = digits;
  if (n.length === 12 && n.startsWith('91')) n = n.slice(2);
  else if (n.length === 13 && n.startsWith('091')) n = n.slice(3);
  else if (n.length === 11 && n.startsWith('0')) n = n.slice(1);
  if (!/^[6-9]\d{9}$/u.test(n)) {
    throw new Error(`'${input}' is not a valid Indian mobile number`);
  }
  return `+91${n}`;
}

/**
 * `users.portal_exec_id` is uniquely indexed where not null. Silently moving an
 * id between people would redirect a colleague's incoming orders, so a clash
 * with a different user is an error rather than an overwrite.
 */
async function assertPortalIdFree(
  db: ReturnType<typeof drizzle>,
  portalExecId: number,
  intendedUserId: string | null,
): Promise<void> {
  const [holder] = await db
    .select({ id: users.id, name: users.fullName })
    .from(users)
    .where(eq(users.portalExecId, portalExecId))
    .limit(1);
  if (holder && holder.id !== intendedUserId) {
    throw new Error(
      `portal exec id ${portalExecId} already belongs to ${holder.name}. ` +
        'Two people cannot share one CartPlus employee id.',
    );
  }
}

function tempPassword(): string {
  return randomBytes(9).toString('base64url');
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');

  const dryRun = process.env.DRY_RUN === '1';
  const roster = JSON.parse(requireEnv('SALES_EXECS_JSON')) as ExecSpec[];
  if (!Array.isArray(roster) || roster.length === 0) {
    throw new Error('SALES_EXECS_JSON must be a non-empty array');
  }
  const secretsOut = process.env.EXEC_SECRETS_OUT ?? '';

  // Reject duplicate phones up front. Two rows differing only by name would
  // otherwise fail halfway through on the unique index, leaving a partial import.
  const seen = new Map<string, string>();
  const seenPortalIds = new Map<number, string>();
  for (const spec of roster) {
    const p = toStoragePhone(spec.phone);
    const prior = seen.get(p);
    if (prior) throw new Error(`duplicate phone in roster: ${spec.name} and ${prior}`);
    seen.set(p, spec.name);
    if (spec.portalExecId !== undefined) {
      const priorId = seenPortalIds.get(spec.portalExecId);
      if (priorId) {
        throw new Error(
          `duplicate portal exec id ${spec.portalExecId}: ${spec.name} and ${priorId}`,
        );
      }
      seenPortalIds.set(spec.portalExecId, spec.name);
    }
  }

  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(client, { casing: 'snake_case' });

  const minted: string[] = [];
  const log = (line: string) => console.log(`[seed:execs] ${line}`);

  for (const spec of roster) {
    const phone = toStoragePhone(spec.phone);

    const [city] = await db
      .select({ id: cities.id, name: cities.name, captain: cities.captainUserId })
      .from(cities)
      .where(eq(cities.name, spec.city))
      .limit(1);
    if (!city) {
      throw new Error(
        `city '${spec.city}' does not exist — create it before importing executives`,
      );
    }
    if (!city.captain) {
      throw new Error(
        `city '${spec.city}' has no captain. sales_executives.captain_user_id is\n` +
          'NOT NULL, so this executive cannot be created. Assign a captain first\n' +
          '(scripts/seed-captains.ts).',
      );
    }

    // Match on phone first, then on name among executives — the same rule as
    // the captain seeder, so a number can be corrected without duplicating a person.
    let [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
    if (!user) {
      [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.fullName, spec.name), eq(users.role, 'sales_executive')))
        .limit(1);
      if (user && user.phone !== phone) {
        log(`${spec.name}: phone changes ${user.phone} -> ${phone}`);
        if (!dryRun) {
          await db
            .update(users)
            .set({ phone, updatedAt: new Date() })
            .where(eq(users.id, user.id));
        }
      }
    }

    if (user && user.role !== 'sales_executive') {
      throw new Error(
        `${phone} already belongs to ${user.fullName} with role '${user.role}'. ` +
          'Refusing to change an existing account\'s role.',
      );
    }

    if (spec.portalExecId !== undefined) {
      await assertPortalIdFree(db, spec.portalExecId, user?.id ?? null);
    }

    if (!user) {
      log(`${spec.name}: CREATE sales executive in ${city.name}`);
      if (!dryRun) {
        const plaintext = tempPassword();
        const [created] = await db
          .insert(users)
          .values({
            role: 'sales_executive',
            fullName: spec.name,
            phone,
            email: spec.email ?? null,
            emailVerified: false,
            phoneVerified: false,
            isActive: true,
            portalExecId: spec.portalExecId ?? null,
            // Forces a change at first login, matching the captains created in HVA-348.
            mustChangePassword: true,
          })
          .returning();
        await db.insert(accounts).values({
          accountId: created.id,
          providerId: 'credential',
          userId: created.id,
          password: await hashPassword(plaintext),
        });
        user = created;
        minted.push(`${spec.name}\t${phone}\t${city.name}\t${plaintext}`);
      }
    } else {
      log(`${spec.name}: exists (${user.id}) — password left untouched`);
      if (spec.portalExecId !== undefined && user.portalExecId !== spec.portalExecId) {
        log(`  portal exec id ${user.portalExecId ?? 'none'} -> ${spec.portalExecId}`);
        if (!dryRun) {
          await db
            .update(users)
            .set({ portalExecId: spec.portalExecId, updatedAt: new Date() })
            .where(eq(users.id, user.id));
        }
      }
    }

    if (!dryRun && user) {
      // The sales_executives row is what exec surfaces join against; a user
      // without it is a half-made executive that the app will not route work to.
      await db
        .insert(salesExecutives)
        .values({ userId: user.id, captainUserId: city.captain, cityId: city.id })
        .onConflictDoUpdate({
          target: salesExecutives.userId,
          set: { captainUserId: city.captain, cityId: city.id, updatedAt: new Date() },
        });
    }
    log(`  ${spec.name} -> ${city.name}`);
  }

  if (minted.length > 0) {
    if (!secretsOut) {
      throw new Error(
        'New executives were created but EXEC_SECRETS_OUT is not set. Refusing to\n' +
          'print temp passwords to stdout — set the path and re-run.',
      );
    }
    writeFileSync(
      secretsOut,
      '# Temp passwords — HVA-349. Each executive must change this at first login.\n' +
        '# Hand over individually, then delete this file.\n' +
        `# name\tphone\tcity\ttemp_password\n${minted.join('\n')}\n`,
      { mode: 0o600 },
    );
    chmodSync(secretsOut, 0o600);
    log(`${minted.length} temp password(s) written to ${secretsOut} (chmod 600)`);
  } else {
    log('no new users — no passwords minted');
  }

  if (dryRun) log('DRY RUN — nothing was written');
  await client.end();
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('[seed:execs] failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
