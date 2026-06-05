import { hashPassword } from 'better-auth/crypto';
import postgres from 'postgres';

// =============================================================================
// HVA-198: seed canonical e2e users + a city
// =============================================================================
//
// Stripped-down equivalent of `scripts/seed.ts` — only the rows the
// Playwright auth flows need:
//   - Veera (sales executive, +91 9000040001 / Test#Veera1)
//   - Arjun (captain,         +91 9000020001 / Test#Arjun1)
//   - Sandeep (super admin,   +91 9885698665 / SandyTest#1 — same as
//     prod for muscle-memory, but the testcontainer is isolated so
//     this credential pair has no security value outside the run)
//   - A Hyderabad city assigned to Arjun
//   - The sales_executives row linking Veera to Arjun + Hyderabad
//
// Uses raw `postgres` SQL (not Drizzle) so this file has no transitive
// dependency on the lazy `db/client` — keeps the Playwright runner's
// boot path simple.
// =============================================================================

export interface SeededE2EUsers {
  exec: { id: string; phone: string; password: string; fullName: string };
  captain: { id: string; phone: string; password: string; fullName: string };
  superAdmin: { id: string; phone: string; password: string; fullName: string };
  cityId: string;
}

interface UserSeed {
  role: 'sales_executive' | 'captain' | 'super_admin';
  phone: string;
  password: string;
  fullName: string;
}

const VEERA: UserSeed = {
  role: 'sales_executive',
  phone: '+919000040001',
  password: 'Test#Veera1',
  fullName: 'Veera (e2e exec)',
};
const ARJUN: UserSeed = {
  role: 'captain',
  phone: '+919000020001',
  password: 'Test#Arjun1',
  fullName: 'Arjun (e2e captain)',
};
const SANDEEP: UserSeed = {
  role: 'super_admin',
  phone: '+919885698665',
  password: 'SandyTest#1',
  fullName: 'Sandeep (e2e admin)',
};

async function insertUser(
  sql: ReturnType<typeof postgres>,
  seed: UserSeed,
): Promise<string> {
  const passwordHash = await hashPassword(seed.password);
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (role, full_name, phone, phone_verified, is_active, must_change_password)
    VALUES (${seed.role}::user_role, ${seed.fullName}, ${seed.phone}, true, true, false)
    RETURNING id
  `;
  await sql`
    INSERT INTO accounts (account_id, provider_id, user_id, password)
    VALUES (${row.id}, 'credential', ${row.id}, ${passwordHash})
  `;
  return row.id;
}

export async function seedE2EUsers(
  connectionString: string,
): Promise<SeededE2EUsers> {
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  try {
    const veeraId = await insertUser(sql, VEERA);
    const arjunId = await insertUser(sql, ARJUN);
    const sandeepId = await insertUser(sql, SANDEEP);

    // Captains subtype row.
    await sql`INSERT INTO captains (user_id) VALUES (${arjunId})`;

    // A city assigned to Arjun.
    const [city] = await sql<{ id: string }[]>`
      INSERT INTO cities (name, state, captain_user_id, is_active)
      VALUES ('Hyderabad', 'Telangana', ${arjunId}, true)
      ON CONFLICT (name) DO UPDATE SET captain_user_id = ${arjunId}, is_active = true
      RETURNING id
    `;

    // Sales-executive subtype row linking Veera to Arjun + Hyderabad.
    await sql`
      INSERT INTO sales_executives (user_id, captain_user_id, city_id)
      VALUES (${veeraId}, ${arjunId}, ${city.id})
    `;

    return {
      exec: {
        id: veeraId,
        phone: VEERA.phone,
        password: VEERA.password,
        fullName: VEERA.fullName,
      },
      captain: {
        id: arjunId,
        phone: ARJUN.phone,
        password: ARJUN.password,
        fullName: ARJUN.fullName,
      },
      superAdmin: {
        id: sandeepId,
        phone: SANDEEP.phone,
        password: SANDEEP.password,
        fullName: SANDEEP.fullName,
      },
      cityId: city.id,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
