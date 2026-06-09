import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  notificationRules,
  statusStages,
  statusTransitions,
  tasks,
  visitRequests,
} from '@/db/schema';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { scheduleVisitAction } from '@/lib/visit-schedule/actions';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-253 (HVA-226 lifted): generalised calendar / auto-task action
// =============================================================================
//
// Migration 0070 seeded:
//   - ORDER_CONFIRMED → INSTALLATION_SCHEDULED: auto_task_type='installation',
//     emits_event='request.installation_scheduled', requires_datetime=false
//     by default (admin opts in).
//   - 6 notification_rules rows for request.installation_scheduled.
//
// truncateAll() wipes notification_rules between tests. Re-seed in
// beforeEach so notification fan-out is exercised. requires_datetime on
// the install row is also reset every test since seed default is false
// but our tests flip it on for the call.
// =============================================================================

beforeEach(async () => {
  await db.execute(sql.raw(`
    INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
    VALUES
      ('request.installation_scheduled', 'in_app', 'exec_assigned',       true, NULL),
      ('request.installation_scheduled', 'in_app', 'captain_owning_city', true, NULL),
      ('request.installation_scheduled', 'in_app', 'super_admin',         true, NULL),
      ('request.installation_scheduled', 'push',   'exec_assigned',       true, NULL),
      ('request.installation_scheduled', 'push',   'captain_owning_city', true, NULL),
      ('request.installation_scheduled', 'push',   'super_admin',         true, NULL)
    ON CONFLICT (event_type, channel, recipient_role) DO NOTHING;
  `));
});

async function setTransitionRequiresDatetime(
  fromCode: string,
  toCode: string,
  required: boolean,
): Promise<void> {
  await db.execute(sql.raw(`
    UPDATE status_transitions st
    SET requires_datetime = ${required}
    FROM status_stages fs, status_stages ts
    WHERE st.from_stage_id = fs.id
      AND st.to_stage_id = ts.id
      AND fs.code = '${fromCode}'
      AND ts.code = '${toCode}'
      AND st.kind = 'forward';
  `));
}

function futureDateIso(daysFromNow = 2): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

describe('scheduleVisitAction — VISIT_SCHEDULED path (regression)', () => {
  it('flips status, writes visit_scheduled_at, creates Customer-home-visit task', async () => {
    const captain = await seedCaptain({ phone: '+919930000001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919930000002',
      fullName: 'Exec ScheduleVisit',
      password: 'Schedule#1',
    });

    // Seed a request at ASSIGNED (the from-stage of the VISIT_SCHEDULED transition)
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
      statusStageCode: 'ASSIGNED',
    });
    const visitStage = await getStatusStage('VISIT_SCHEDULED');

    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const when = futureDateIso();
    const r = await scheduleVisitAction({
      requestId: req.id,
      nextStatusId: visitStage.id,
      visitScheduledAt: when,
    });
    expect(r.ok).toBe(true);

    // Status flipped + visit_scheduled_at written
    const [updated] = await db
      .select()
      .from(visitRequests)
      .where(eq(visitRequests.id, req.id));
    expect(updated!.statusStageId).toBe(visitStage.id);
    expect(updated!.visitScheduledAt).not.toBeNull();

    // Customer home visit task created
    const taskRows = await db
      .select()
      .from(tasks)
      .where(eq(tasks.linkRequestId, req.id));
    expect(taskRows.length).toBe(1);
    expect(taskRows[0]!.taskType).toBe('Customer home visit');
    expect(taskRows[0]!.execUserId).toBe(exec.id);
  });
});

describe('scheduleVisitAction — INSTALLATION_SCHEDULED path (new)', () => {
  it('flips status, does NOT write visit_scheduled_at, creates Installation task', async () => {
    const captain = await seedCaptain({ phone: '+919930100001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919930100002',
      fullName: 'Exec ScheduleInstall',
      password: 'Install#1',
    });

    // Seed at ORDER_CONFIRMED + flip requires_datetime on the install transition
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
      statusStageCode: 'ORDER_CONFIRMED',
    });
    await setTransitionRequiresDatetime(
      'ORDER_CONFIRMED',
      'INSTALLATION_SCHEDULED',
      true,
    );
    const installStage = await getStatusStage('INSTALLATION_SCHEDULED');

    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const when = futureDateIso();
    const r = await scheduleVisitAction({
      requestId: req.id,
      nextStatusId: installStage.id,
      visitScheduledAt: when,
    });
    expect(r.ok).toBe(true);

    const [updated] = await db
      .select()
      .from(visitRequests)
      .where(eq(visitRequests.id, req.id));
    expect(updated!.statusStageId).toBe(installStage.id);
    // visit_scheduled_at must NOT be set — the column is purpose-specific
    // to the VISIT_SCHEDULED move
    expect(updated!.visitScheduledAt).toBeNull();

    // Installation task created with the right type
    const taskRows = await db
      .select()
      .from(tasks)
      .where(eq(tasks.linkRequestId, req.id));
    expect(taskRows.length).toBe(1);
    expect(taskRows[0]!.taskType).toBe('Installation & Activation');
    expect(taskRows[0]!.execUserId).toBe(exec.id);
  });
});

describe('scheduleVisitAction — validation', () => {
  it('rejects when destination transition has requires_datetime=false', async () => {
    const captain = await seedCaptain({ phone: '+919930200001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919930200002',
      fullName: 'Exec RejectTransition',
      password: 'Reject#1',
    });
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
      statusStageCode: 'ORDER_CONFIRMED',
    });
    // Install transition has requires_datetime=false by default — test
    // that calling the action without flipping it on gets rejected.
    await setTransitionRequiresDatetime(
      'ORDER_CONFIRMED',
      'INSTALLATION_SCHEDULED',
      false,
    );
    const installStage = await getStatusStage('INSTALLATION_SCHEDULED');

    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const r = await scheduleVisitAction({
      requestId: req.id,
      nextStatusId: installStage.id,
      visitScheduledAt: futureDateIso(),
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.error.toLowerCase()).toMatch(/date.+time.+picker|requires_datetime/i);
    }
  });

  it('rejects past dates', async () => {
    const captain = await seedCaptain({ phone: '+919930300001' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919930300002',
      fullName: 'Exec PastDate',
      password: 'Past#1',
    });
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
      statusStageCode: 'ASSIGNED',
    });
    const visitStage = await getStatusStage('VISIT_SCHEDULED');

    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const past = new Date();
    past.setDate(past.getDate() - 1);

    const r = await scheduleVisitAction({
      requestId: req.id,
      nextStatusId: visitStage.id,
      visitScheduledAt: past.toISOString(),
    });
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.error.toLowerCase()).toMatch(/future/i);
    }
  });
});

// Reference imports the linter would otherwise drop.
void notificationRules;
void statusStages;
void statusTransitions;
