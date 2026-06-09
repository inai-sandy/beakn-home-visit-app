import { hashPassword } from 'better-auth/crypto';
import { eq, sql as sqlBuilder } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  accounts,
  captains,
  cities,
  salesExecutives,
  statusStages,
  users,
  visitRequests,
} from '@/db/schema';

// =============================================================================
// HVA-101: DB helpers for tests
// =============================================================================
//
// All helpers exercise the actual Drizzle schema — no string columns where
// FKs exist, no fictional `users.captain_id`. The relationships used here
// were verified against the live schema before the harness was written:
//
//   - users.role enum: 'sales_executive' | 'captain' | 'super_admin'
//     (NOT 'sales_exec')
//   - cities.captain_user_id → users.id  (nullable, ON DELETE SET NULL)
//   - cities.captain_routing_email — separate routing column (HVA-90)
//   - captains.user_id PK + FK to users.id
//   - sales_executives.user_id PK, sales_executives.captain_user_id FK
//     to users.id (NOT users.captain_id — that column does not exist)
//   - visit_requests.status_stage_id FK to status_stages.id
//
// Password hashing uses better-auth/crypto so seeded users can sign in
// through auth.api.signInPhoneNumber.
// =============================================================================

export function getTestDb() {
  return db;
}

// -----------------------------------------------------------------------------
// Truncate — afterEach hook in tests/setup/per-file.ts
// -----------------------------------------------------------------------------
//
// We do this carefully. `cities` and `status_stages` are seeded by
// migrations 0004 + 0005, and tests against the system rely on those
// rows being present. PostgreSQL's `TRUNCATE … CASCADE` walks FK
// references regardless of `ON DELETE SET NULL` — so a naive cascade
// from `users` reaches `cities.captain_user_id` and wipes it.
//
// Strategy:
//   1. Truncate every leaf + intermediate table that holds test-fixture
//      data (audit, sessions, requests, etc.).
//   2. Null out cities.captain_user_id so the FK to users no longer
//      blocks step 3.
//   3. Truncate `users` without CASCADE — nothing references it now.
//
// status_stages keeps its seeded rows automatically: nothing the suite
// truncates references it back, and we never touch it directly.

// Every test-mutable table in the schema EXCEPT cities + status_stages +
// outcome_options + postpone_reasons (all migration-seeded reference
// tables that must survive between tests — HVA-60 0021 seeds outcome +
// postpone rows; HVA-33/HVA-67 seeded cities + status_stages) and config
// (loaded once + cached). This list is enumerated against
// information_schema in the harness preflight; new tables added by
// future migrations need to be appended here.
const SAFE_TRUNCATE_TABLES = [
  'accounts',
  'admin_help_messages',
  // HVA-156 / FIX1 / FIX2: resources/announcements + their categories +
  // acknowledgments all FK to users. Truncating them before the
  // DELETE FROM users step keeps both the cascade graph and the unique
  // phone constraint clean between tests.
  'announcement_acknowledgments',
  'announcements',
  'announcement_categories',
  'audit_log',
  'business_types',
  'captains',
  // HVA-238 (HVA-231 Phase 2 PR-A): dispatch tables reference users
  // (dispatched_by_user_id, changed_by_user_id) with ON DELETE RESTRICT.
  // Must be truncated before the DELETE FROM users step. The 3 tables
  // CASCADE among themselves (dispatch_items + history → dispatches),
  // but listing all three explicitly is robust if a future migration
  // adds a different FK that changes the cascade graph.
  'dispatch_status_history',
  'dispatch_items',
  'dispatches',
  'day_plans',
  'holidays',
  'in_app_notifications',
  'leads',
  // HVA-73 PR 2 + PR 3: notes.created_by_user_id → users with ON DELETE
  // RESTRICT. Without truncating it between tests, the DELETE FROM users
  // at the end of truncateAll blows up with an FK violation, and every
  // subsequent test's seedCaptain collides on the unique phone.
  'notes',
  // HVA-241 (HVA-231 Phase 3): order_comments.author_user_id is
  // ON DELETE RESTRICT — same reason notes had to be added above.
  'order_comments',
  'notification_rules',
  'notifications_queue',
  'payments',
  'quotations',
  'rate_limit_attempts',
  'rate_limits',
  'request_reschedule_history',
  'request_status_history',
  // HVA-156-FIX1: resources FK → resource_categories. Truncate resources
  // first so the categories truncate doesn't trip the RESTRICT cascade.
  'resources',
  'resource_categories',
  'sales_executives',
  'sessions',
  'tasks',
  'verifications',
  'visit_requests',
  // HVA-228 — warnings reference users(issued_by_user_id, exec_user_id,
  // revoked_by_user_id) with ON DELETE RESTRICT. Must be truncated
  // before the DELETE FROM users step.
  'warnings',
  // HVA-248 (HVA-230): webhook_secrets.created_by_user_id → users
  // ON DELETE RESTRICT. Must precede DELETE FROM users. webhook_events
  // has no FK but lives next to it.
  'webhook_events',
  'webhook_secrets',
  // HVA-254 (HVA-232): support_tickets.claimed_by_user_id +
  // resolved_by_user_id are ON DELETE RESTRICT. Truncate before users.
  'support_tickets',
];

export async function truncateAll(): Promise<void> {
  // TRUNCATE everything except cities/status_stages/config (migration
  // seeds, must survive) and users (cleared via DELETE below).
  //
  // We can't include users in a TRUNCATE-CASCADE because the cascade
  // walks the FK constraint graph (not the value graph) and would drag
  // cities along, wiping the migration seed. PostgreSQL's `ON DELETE
  // SET NULL` only kicks in for actual DELETE statements.
  await db.execute(
    sqlBuilder.raw(
      `TRUNCATE TABLE ${SAFE_TRUNCATE_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE;`,
    ),
  );
  // DELETE FROM users triggers cities.captain_user_id ON DELETE SET NULL,
  // so the cities seed stays intact and just has its FK column nulled.
  await db.execute(sqlBuilder.raw('DELETE FROM "users";'));
  // Reset the mutable cities columns (HVA-90 / HVA-110) — these are
  // admin-editable routing config that tests freely mutate. Without an
  // explicit reset, the testcontainer's .withReuse() option means
  // mutations bleed across runs (Bangalore left with a captain_routing_email
  // from yesterday's session showed up as a flake here).
  // HVA-156-FIX1: re-seed resource_categories with the same starter rows
  // migration 0033 inserted. Truncating drops them; tests need at least one
  // active category to insert resources against, so we re-insert here.
  await db.execute(
    sqlBuilder.raw(`
      INSERT INTO resource_categories (name, slug, sort_order, display_order) VALUES
        ('Sales scripts', 'sales-scripts', 10, 10),
        ('Pricing',       'pricing',       20, 20),
        ('Brand assets',  'brand-assets',  30, 30),
        ('Training',      'training',      40, 40),
        ('Other',         'other',         99, 99)
      ON CONFLICT DO NOTHING;
    `),
  );
  // HVA-156-FIX2: re-seed announcement_categories with starter rows from
  // migration 0035.
  await db.execute(
    sqlBuilder.raw(`
      INSERT INTO announcement_categories (name, slug, sort_order, display_order) VALUES
        ('Operational', 'operational', 10, 10),
        ('Policy',      'policy',      20, 20),
        ('Pricing',     'pricing',     30, 30),
        ('Product',     'product',     40, 40),
        ('Other',       'other',       99, 99)
      ON CONFLICT DO NOTHING;
    `),
  );
  await db.execute(
    sqlBuilder.raw(
      'UPDATE cities SET captain_routing_email = NULL, other_routing_email = NULL, discord_webhook_url = NULL, cartplus_store_id = NULL;',
    ),
  );
}

// -----------------------------------------------------------------------------
// Seed helpers
// -----------------------------------------------------------------------------

export interface SeedUserResult {
  id: string;
  phone: string;
  password: string;
}

export type Role = 'super_admin' | 'captain' | 'sales_executive';

interface SeedUserInput {
  role: Role;
  fullName?: string;
  phone: string;
  password: string;
  email?: string | null;
  isActive?: boolean;
  mustChangePassword?: boolean;
}

export async function seedUser(input: SeedUserInput): Promise<SeedUserResult> {
  const passwordHash = await hashPassword(input.password);
  const [row] = await db
    .insert(users)
    .values({
      role: input.role,
      fullName: input.fullName ?? `Test ${input.role}`,
      phone: input.phone,
      email: input.email ?? null,
      phoneVerified: true,
      isActive: input.isActive ?? true,
      mustChangePassword: input.mustChangePassword ?? false,
    })
    .returning({ id: users.id });
  await db.insert(accounts).values({
    accountId: row.id,
    providerId: 'credential',
    userId: row.id,
    password: passwordHash,
  });
  return { id: row.id, phone: input.phone, password: input.password };
}

export async function seedSuperAdmin(
  overrides: Partial<SeedUserInput> = {},
): Promise<SeedUserResult> {
  return seedUser({
    role: 'super_admin',
    phone: '+918888800001',
    password: 'TestAdmin#1',
    fullName: 'Test Super Admin',
    ...overrides,
  });
}

export async function seedCaptain(
  overrides: Partial<SeedUserInput> = {},
): Promise<SeedUserResult> {
  const u = await seedUser({
    role: 'captain',
    phone: '+919000011111',
    password: 'TestCaptain#1',
    fullName: 'Test Captain',
    ...overrides,
  });
  await db.insert(captains).values({ userId: u.id });
  return u;
}

export async function seedExecutive(
  captainUserId: string,
  overrides: Partial<SeedUserInput> = {},
): Promise<SeedUserResult> {
  const u = await seedUser({
    role: 'sales_executive',
    phone: '+919100011111',
    password: 'TestExec#1',
    fullName: 'Test Sales Exec',
    ...overrides,
  });
  await db.insert(salesExecutives).values({ userId: u.id, captainUserId });
  return u;
}

export async function getOrCreateCity(name: string): Promise<{ id: string; name: string }> {
  const existing = await db
    .select({ id: cities.id, name: cities.name })
    .from(cities)
    .where(eq(cities.name, name))
    .limit(1);
  if (existing.length > 0) return existing[0];
  const [row] = await db
    .insert(cities)
    .values({ name, isActive: true })
    .returning({ id: cities.id, name: cities.name });
  return row;
}

export async function getStatusStage(code: string): Promise<{
  id: string;
  code: string;
  sequenceNumber: number;
  name: string;
}> {
  const [row] = await db
    .select({
      id: statusStages.id,
      code: statusStages.code,
      sequenceNumber: statusStages.sequenceNumber,
      name: statusStages.name,
    })
    .from(statusStages)
    .where(eq(statusStages.code, code))
    .limit(1);
  if (!row) throw new Error(`status_stages row missing for code ${code}`);
  return row;
}

interface SeedRequestInput {
  cityId: string;
  assignedExecUserId?: string | null;
  assignedCaptainUserId?: string | null;
  /** Default: 'SUBMITTED'. */
  statusStageCode?: string;
}

export async function seedVisitRequest(
  input: SeedRequestInput,
): Promise<{ id: string }> {
  const stage = await getStatusStage(input.statusStageCode ?? 'SUBMITTED');
  const [row] = await db
    .insert(visitRequests)
    .values({
      customerName: 'Test Customer',
      customerPhone: '+919999999999',
      customerEmail: null,
      address: 'Test address line',
      cityId: input.cityId,
      bhk: '3BHK',
      interest: ['Automation'],
      trackingToken: `t_${Math.random().toString(36).slice(2, 23)}`,
      statusStageId: stage.id,
      assignedExecUserId: input.assignedExecUserId ?? null,
      assignedCaptainUserId: input.assignedCaptainUserId ?? null,
      assignedAt: input.assignedExecUserId ? new Date() : null,
    })
    .returning({ id: visitRequests.id });
  return row;
}
