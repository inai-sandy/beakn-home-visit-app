// Create or update captains and give each of their cities an owner.
//
// HVA-348. Written because HVA-343 switched on every WhatsApp rule, several of
// which target `captain_owning_city` — a resolver that reads
// `cities.captain_user_id`. A city with no captain makes those rules resolve to
// nothing and record a skipped delivery: the message is enabled and lands
// nowhere. Six of eight cities had no owner when this was written.
//
// NOT A MIGRATION, deliberately. No migration in this repo has ever inserted a
// user, and one that did would create real people in every test database and on
// every CI run. `seed-test-admin.ts` is the precedent this follows: a committed
// script, invoked explicitly, credentials passed in rather than embedded.
//
// CREDENTIAL + PII HYGIENE: the roster comes from the environment, never from
// this file, so phone numbers stay out of `git log`. Generated temp passwords
// are written to a chmod 600 file — never stdout, which on this project ends up
// in a transcript.
//
//   CAPTAINS_JSON='[{"name":"Asha","phone":"9876543210","cities":["Pune"]}]' \
//   CAPTAIN_SECRETS_OUT=/home/beakn/captain-temp-passwords.txt \
//   DATABASE_URL=postgresql://beakn_app:PW@127.0.0.1:5432/beakn_app \
//     pnpm tsx scripts/seed-captains.ts
//
// Add DRY_RUN=1 to print the plan and change nothing.
//
// Idempotent. A captain who already exists keeps their password — only a
// genuinely new user gets one minted. Re-running after a city move is a no-op.

import { randomBytes } from 'node:crypto';
import { chmodSync, writeFileSync } from 'node:fs';

import { hashPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { accounts } from '../db/schema/accounts';
import { users } from '../db/schema/auth';
import { captains, cities } from '../db/schema/org';

interface CaptainSpec {
  name: string;
  phone: string;
  cities: string[];
  /**
   * The CartPlus "employee id". Captains raise orders in CartPlus too, so
   * without this on `users.portal_exec_id` their own orders arrive unassigned.
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
 * `users.portal_exec_id` is uniquely indexed where not null. Moving an id
 * between people would redirect a colleague's incoming orders, so a clash with
 * a different user is an error rather than an overwrite.
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
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set.');
  }
  const dryRun = process.env.DRY_RUN === '1';
  const roster = JSON.parse(requireEnv('CAPTAINS_JSON')) as CaptainSpec[];
  if (!Array.isArray(roster) || roster.length === 0) {
    throw new Error('CAPTAINS_JSON must be a non-empty array');
  }
  const secretsOut = process.env.CAPTAIN_SECRETS_OUT ?? '';

  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(client, { casing: 'snake_case' });

  const minted: string[] = [];
  // Cities this run assigns. Tracked so the summary below is truthful under
  // DRY_RUN, where nothing is written and a re-read would report every planned
  // assignment as still missing an owner.
  const assigned = new Set<string>();
  const log = (line: string) => console.log(`[seed:captains] ${line}`);

  for (const spec of roster) {
    const phone = toStoragePhone(spec.phone);

    // Match on phone first, then on name among captains. Arjun already existed
    // under a different number, so name is what identifies the person when the
    // phone is the thing being corrected.
    let [user] = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
    if (!user) {
      [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.fullName, spec.name), eq(users.role, 'captain')))
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

    if (spec.portalExecId !== undefined) {
      await assertPortalIdFree(db, spec.portalExecId, user?.id ?? null);
    }

    if (!user) {
      log(`${spec.name}: CREATE captain`);
      if (!dryRun) {
        const plaintext = tempPassword();
        const [created] = await db
          .insert(users)
          .values({
            role: 'captain',
            fullName: spec.name,
            phone,
            email: null,
            emailVerified: false,
            phoneVerified: false,
            isActive: true,
            portalExecId: spec.portalExecId ?? null,
            // Forces a change at first login, matching how the bootstrap admin
            // and the existing captains were created.
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
        minted.push(`${spec.name}\t${phone}\t${plaintext}`);
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
      // The captains row is separate from users and is what the captain
      // surfaces join against; a user without it is a half-made captain.
      await db.insert(captains).values({ userId: user.id }).onConflictDoNothing();
    }

    for (const cityName of spec.cities) {
      const [city] = await db
        .select({ id: cities.id, owner: cities.captainUserId })
        .from(cities)
        .where(eq(cities.name, cityName))
        .limit(1);
      if (!city) {
        throw new Error(
          `city '${cityName}' does not exist — create it before assigning an owner`,
        );
      }
      if (user && city.owner === user.id) {
        log(`  ${cityName}: already owned by ${spec.name}`);
        continue;
      }
      if (city.owner) {
        const [prev] = await db
          .select({ name: users.fullName })
          .from(users)
          .where(eq(users.id, city.owner))
          .limit(1);
        log(`  ${cityName}: OWNER CHANGES ${prev?.name ?? city.owner} -> ${spec.name}`);
      } else {
        log(`  ${cityName}: assigning ${spec.name} (had no captain)`);
      }
      assigned.add(cityName);
      if (!dryRun && user) {
        await db
          .update(cities)
          .set({ captainUserId: user.id, updatedAt: new Date() })
          .where(eq(cities.id, city.id));
      }
    }
  }

  // Any city still without an owner is a silent hole in captain notifications,
  // so it is reported rather than left to be noticed later.
  const allCities = await db
    .select({ name: cities.name, owner: cities.captainUserId })
    .from(cities);
  const stillUnowned = allCities
    .filter((c) => !c.owner && !assigned.has(c.name))
    .map((c) => c.name);
  if (stillUnowned.length > 0) {
    log(
      `cities STILL WITHOUT A CAPTAIN: ${stillUnowned.join(', ')} — ` +
        'captain_owning_city rules cannot fire for these',
    );
  } else {
    log('every city has a captain');
  }

  if (minted.length > 0) {
    if (!secretsOut) {
      throw new Error(
        'New captains were created but CAPTAIN_SECRETS_OUT is not set. Refusing to\n' +
          'print temp passwords to stdout — set the path and re-run.',
      );
    }
    writeFileSync(
      secretsOut,
      `# Temp passwords — HVA-348. Each captain must change this at first login.\n` +
        `# Delete this file once handed over.\n` +
        `# name\tphone\ttemp_password\n${minted.join('\n')}\n`,
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
    console.error(
      '[seed:captains] failed:',
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  });
