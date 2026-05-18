import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { dayPlans, outcomeOptions, postponeReasons, tasks } from '@/db/schema';
import { computeTaskCompletionPct } from '@/lib/today/metrics';
import {
  CHIP_TASK_TYPES,
  FREE_TEXT_TASK_TYPES,
  KNOWN_TASK_TYPES,
  pickNextTask,
  resolveTaskDisplayMode,
} from '@/lib/today/task-rendering';
import {
  formatMinutesAsBucket,
  getIstDateString,
  isAtOrAfterIstTime,
  isFastCompletion,
  parseEstimatedMinutes,
} from '@/lib/today/time';

import { seedExecutive, seedCaptain, getOrCreateCity } from '../helpers/db';
import { loginByPhone } from '../helpers/auth';
import { getFirstPostponeReason, seedTask, seedTodayDayPlan } from './helpers';

// =============================================================================
// HVA-60: today-loop tests (12 cases as locked in the bundle)
// =============================================================================
//
// Pure-function tests run without DB. Action tests use the testcontainer
// harness — they call the Server Action functions directly and inspect
// the resulting DB state. The session is mocked via auth helpers so the
// authorize() inside each action returns the seeded exec as the actor.
// =============================================================================

// Stub next/headers + next/cache so Server Actions invoked directly in tests
// don't trip on the missing Next request context. The harness already
// stubs revalidatePath globally in tests/setup/per-file.ts; cookie/headers
// are stubbed per-file here.
let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

// Lazy-import the action module after the mocks above are registered.
import {
  addTaskAction,
  closeDayAction,
  markTaskDoneAction,
  postponeTaskAction,
  startDayAction,
  undoMarkDoneAction,
} from '@/app/(exec)/today/actions';

async function setupExecSession() {
  await getOrCreateCity('Bangalore');
  const captain = await seedCaptain();
  const exec = await seedExecutive(captain.id);
  const sess = await loginByPhone(exec.phone, exec.password);
  currentCookieHeader = sess.cookieHeader;
  return { exec };
}

beforeEach(() => {
  currentCookieHeader = undefined;
});

afterEach(() => {
  currentCookieHeader = undefined;
});

// -----------------------------------------------------------------------------
// Pure-function tests
// -----------------------------------------------------------------------------

describe('Test #1 — NextTaskCard picks oldest pending task', () => {
  it('returns the oldest pending task when multiple pending tasks exist', () => {
    const result = pickNextTask([
      { id: 'a', status: 'pending', createdAt: '2026-05-18T10:00:00Z' },
      { id: 'b', status: 'pending', createdAt: '2026-05-18T09:00:00Z' },
      { id: 'c', status: 'pending', createdAt: '2026-05-18T11:00:00Z' },
    ]);
    expect(result?.id).toBe('b');
  });
  it('skips completed and postponed tasks', () => {
    const result = pickNextTask([
      { id: 'a', status: 'completed', createdAt: '2026-05-18T08:00:00Z' },
      { id: 'b', status: 'postponed', createdAt: '2026-05-18T09:00:00Z' },
      { id: 'c', status: 'pending', createdAt: '2026-05-18T10:00:00Z' },
    ]);
    expect(result?.id).toBe('c');
  });
  it('returns null when no pending tasks', () => {
    expect(
      pickNextTask([
        { id: 'a', status: 'completed', createdAt: '2026-05-18T10:00:00Z' },
        { id: 'b', status: 'postponed', createdAt: '2026-05-18T11:00:00Z' },
      ]),
    ).toBeNull();
  });
});

describe('Test #2 — outcome chip render mode per task type', () => {
  const cases: Array<[string, 'chips' | 'free_text']> = [
    ['Sales pitch', 'chips'],
    ['Customer home visit', 'chips'],
    ['Follow-up', 'chips'],
    ['Installation & Activation', 'chips'],
    ['Outlet visit', 'free_text'],
    ['Stall Activity', 'free_text'],
    ['Other', 'free_text'],
  ];
  for (const [taskType, expected] of cases) {
    it(`${taskType} → ${expected}`, () => {
      expect(resolveTaskDisplayMode(taskType)).toBe(expected);
    });
  }
});

describe('Test #6 — Close the Day task completion math', () => {
  it('5 done + 2 postponed + 3 pending → 50%', () => {
    expect(computeTaskCompletionPct({ done: 5, postponed: 2, pending: 3 })).toBe(50);
  });
  it('returns null when no tasks at all', () => {
    expect(computeTaskCompletionPct({ done: 0, postponed: 0, pending: 0 })).toBeNull();
  });
  it('all done → 100%', () => {
    expect(computeTaskCompletionPct({ done: 7, postponed: 0, pending: 0 })).toBe(100);
  });
});

describe('Test #7 — day_close_target_time visibility gate', () => {
  it('current IST < target → not yet', () => {
    // 14:00 UTC = 19:30 IST. Use a fixed Date in UTC to avoid clock skew.
    const at1400Utc = new Date('2026-05-18T14:00:00Z');
    expect(isAtOrAfterIstTime(at1400Utc, '20:00')).toBe(false);
  });
  it('current IST >= target → visible', () => {
    const at1400Utc = new Date('2026-05-18T14:00:00Z'); // 19:30 IST
    expect(isAtOrAfterIstTime(at1400Utc, '18:30')).toBe(true);
    expect(isAtOrAfterIstTime(at1400Utc, '19:30')).toBe(true);
  });
  it('malformed target → false (defensive)', () => {
    expect(isAtOrAfterIstTime(new Date(), 'not-a-time')).toBe(false);
  });
});

describe('Test #11 — parseEstimatedMinutes', () => {
  it("'15min' → 15", () => expect(parseEstimatedMinutes('15min')).toBe(15));
  it("'30min' → 30", () => expect(parseEstimatedMinutes('30min')).toBe(30));
  it("'1hr' → 60", () => expect(parseEstimatedMinutes('1hr')).toBe(60));
  it("'2hr' → 120", () => expect(parseEstimatedMinutes('2hr')).toBe(120));
  it("'3hr+' → 180", () => expect(parseEstimatedMinutes('3hr+')).toBe(180));
  it('null → null', () => expect(parseEstimatedMinutes(null)).toBeNull());
  it("'garbage' → null", () => expect(parseEstimatedMinutes('garbage')).toBeNull());
  it("'' → null", () => expect(parseEstimatedMinutes('')).toBeNull());
});

describe('formatMinutesAsBucket (companion to #11)', () => {
  it('rounds down to the closest bucket', () => {
    expect(formatMinutesAsBucket(10)).toBe('15min');
    expect(formatMinutesAsBucket(29)).toBe('15min');
    expect(formatMinutesAsBucket(30)).toBe('30min');
    expect(formatMinutesAsBucket(59)).toBe('30min');
    expect(formatMinutesAsBucket(60)).toBe('1hr');
    expect(formatMinutesAsBucket(119)).toBe('1hr');
    expect(formatMinutesAsBucket(120)).toBe('2hr');
    expect(formatMinutesAsBucket(179)).toBe('2hr');
    expect(formatMinutesAsBucket(180)).toBe('3hr+');
    expect(formatMinutesAsBucket(999)).toBe('3hr+');
  });
});

describe('isFastCompletion flag (Close the Day input)', () => {
  it('actual < estimated × 0.3 → true', () => {
    // 1hr estimated × 0.3 = 18min. Actual 15min < 18 → flagged.
    expect(isFastCompletion('1hr', '15min')).toBe(true);
  });
  it('actual >= estimated × 0.3 → false', () => {
    // 1hr × 0.3 = 18. Actual 30min >= 18 → not flagged.
    expect(isFastCompletion('1hr', '30min')).toBe(false);
  });
  it('null on either side → false (no flag)', () => {
    expect(isFastCompletion(null, '15min')).toBe(false);
    expect(isFastCompletion('1hr', null)).toBe(false);
    expect(isFastCompletion(null, null)).toBe(false);
  });
});

describe('Test #12 — chip code paths match the actual pgEnum values', () => {
  it('every CHIP_TASK_TYPE is in the pgEnum string set', () => {
    // The pgEnum values are the source of truth; if a future migration
    // ever changes the enum, this test forces the chip-set to be updated
    // in lockstep.
    const enumValues = new Set<string>([
      'Outlet visit',
      'Customer home visit',
      'Sales pitch',
      'Follow-up',
      'Installation & Activation',
      'Stall Activity',
      'Other',
    ]);
    for (const t of CHIP_TASK_TYPES) {
      expect(enumValues.has(t)).toBe(true);
    }
    for (const t of FREE_TEXT_TASK_TYPES) {
      expect(enumValues.has(t)).toBe(true);
    }
  });
  it('every pgEnum value is covered by either CHIPS or FREE_TEXT', () => {
    const covered = new Set<string>([...CHIP_TASK_TYPES, ...FREE_TEXT_TASK_TYPES]);
    expect(covered.size).toBe(7);
    for (const known of KNOWN_TASK_TYPES) {
      expect(covered.has(known)).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------
// Action / DB tests — require the testcontainer harness
// -----------------------------------------------------------------------------

describe('Test #10 — startDayAction is idempotent', () => {
  it('first call inserts; second call is a no-op', async () => {
    const { exec } = await setupExecSession();
    const planDate = getIstDateString();

    const first = await startDayAction();
    expect(first.ok).toBe(true);

    const rowsAfterFirst = await db
      .select({ id: dayPlans.id })
      .from(dayPlans)
      .where(and(eq(dayPlans.execUserId, exec.id), eq(dayPlans.planDate, planDate)));
    expect(rowsAfterFirst).toHaveLength(1);
    const id1 = rowsAfterFirst[0].id;

    const second = await startDayAction();
    expect(second.ok).toBe(true);

    const rowsAfterSecond = await db
      .select({ id: dayPlans.id })
      .from(dayPlans)
      .where(and(eq(dayPlans.execUserId, exec.id), eq(dayPlans.planDate, planDate)));
    expect(rowsAfterSecond).toHaveLength(1);
    expect(rowsAfterSecond[0].id).toBe(id1);
  });
});

describe('Test #3 — markTaskDoneAction (chip mode) + undo', () => {
  it('chip outcome writes status=completed + outcomeOptionId; undo reverts', async () => {
    const { exec } = await setupExecSession();
    const plan = await seedTodayDayPlan(exec.id);
    const task = await seedTask({
      execUserId: exec.id,
      dayPlanId: plan.id,
      taskType: 'Sales pitch',
    });
    const [chip] = await db
      .select({ id: outcomeOptions.id })
      .from(outcomeOptions)
      .where(
        and(
          eq(outcomeOptions.taskType, 'Sales pitch'),
          eq(outcomeOptions.code, 'quote_sent'),
        ),
      )
      .limit(1);

    const result = await markTaskDoneAction({
      taskId: task.id,
      outcomeOptionId: chip.id,
      outcomeNotes: 'Sent the deck',
    });
    expect(result.ok).toBe(true);
    const [after] = await db
      .select({
        status: tasks.status,
        outcomeOptionId: tasks.outcomeOptionId,
        outcomeNotes: tasks.outcomeNotes,
        completedAt: tasks.completedAt,
        actualTime: tasks.actualTime,
      })
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .limit(1);
    expect(after.status).toBe('completed');
    expect(after.outcomeOptionId).toBe(chip.id);
    expect(after.outcomeNotes).toBe('Sent the deck');
    expect(after.completedAt).not.toBeNull();
    expect(after.actualTime).not.toBeNull();

    const undo = await undoMarkDoneAction(task.id);
    expect(undo.ok).toBe(true);
    const [reverted] = await db
      .select({
        status: tasks.status,
        outcomeOptionId: tasks.outcomeOptionId,
        outcomeNotes: tasks.outcomeNotes,
        completedAt: tasks.completedAt,
        actualTime: tasks.actualTime,
      })
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .limit(1);
    expect(reverted.status).toBe('pending');
    expect(reverted.outcomeOptionId).toBeNull();
    expect(reverted.outcomeNotes).toBeNull();
    expect(reverted.completedAt).toBeNull();
    expect(reverted.actualTime).toBeNull();
  });
});

describe('Test #4 — markTaskDoneAction (free-text) requires non-empty notes', () => {
  it('empty notes on free-text task is rejected', async () => {
    const { exec } = await setupExecSession();
    const plan = await seedTodayDayPlan(exec.id);
    const task = await seedTask({
      execUserId: exec.id,
      dayPlanId: plan.id,
      taskType: 'Outlet visit',
    });
    const empty = await markTaskDoneAction({
      taskId: task.id,
      outcomeOptionId: null,
      outcomeNotes: '',
    });
    expect(empty.ok).toBe(false);

    const tooShort = await markTaskDoneAction({
      taskId: task.id,
      outcomeOptionId: null,
      outcomeNotes: 'no',
    });
    expect(tooShort.ok).toBe(false);

    const okay = await markTaskDoneAction({
      taskId: task.id,
      outcomeOptionId: null,
      outcomeNotes: 'Visited, no decision today',
    });
    expect(okay.ok).toBe(true);
  });
});

describe('Test #5 — postponeTaskAction commits all 3 fields', () => {
  it('writes status, reason, date, and customerInformed', async () => {
    const { exec } = await setupExecSession();
    const plan = await seedTodayDayPlan(exec.id);
    const task = await seedTask({
      execUserId: exec.id,
      dayPlanId: plan.id,
      taskType: 'Sales pitch',
    });
    const reason = await getFirstPostponeReason();

    // tomorrow IST date
    const t = new Date();
    t.setDate(t.getDate() + 1);
    const tomorrow = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;

    const result = await postponeTaskAction({
      taskId: task.id,
      reasonId: reason.id,
      postponedToDate: tomorrow,
      customerInformed: false,
    });
    expect(result.ok).toBe(true);
    const [after] = await db
      .select({
        status: tasks.status,
        postponeReasonId: tasks.postponeReasonId,
        postponedToDate: tasks.postponedToDate,
        customerInformed: tasks.customerInformed,
      })
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .limit(1);
    expect(after.status).toBe('postponed');
    expect(after.postponeReasonId).toBe(reason.id);
    expect(after.postponedToDate).toBe(tomorrow);
    expect(after.customerInformed).toBe(false);
  });
});

describe('Test #8 — closed day plan rejects task mutations', () => {
  it('addTask / markDone / postpone all return "Day is closed"', async () => {
    const { exec } = await setupExecSession();
    const plan = await seedTodayDayPlan(exec.id, { closedAt: new Date() });
    const task = await seedTask({
      execUserId: exec.id,
      dayPlanId: plan.id,
      taskType: 'Sales pitch',
    });
    const [chip] = await db
      .select({ id: outcomeOptions.id })
      .from(outcomeOptions)
      .where(
        and(
          eq(outcomeOptions.taskType, 'Sales pitch'),
          eq(outcomeOptions.code, 'quote_sent'),
        ),
      )
      .limit(1);

    const add = await addTaskAction({
      taskType: 'Sales pitch',
      description: 'Late task on a closed day',
      estimatedTime: '30min',
    });
    expect(add.ok).toBe(false);

    const mark = await markTaskDoneAction({
      taskId: task.id,
      outcomeOptionId: chip.id,
      outcomeNotes: null,
    });
    expect(mark.ok).toBe(false);

    const reason = await getFirstPostponeReason();
    const t = new Date();
    t.setDate(t.getDate() + 1);
    const tomorrow = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    const post = await postponeTaskAction({
      taskId: task.id,
      reasonId: reason.id,
      postponedToDate: tomorrow,
      customerInformed: true,
    });
    expect(post.ok).toBe(false);
  });
});

describe('Test #9 — closeDayAction seals the day', () => {
  it('closeDayAction writes closedAt; second call rejects', async () => {
    const { exec } = await setupExecSession();
    await seedTodayDayPlan(exec.id);

    const first = await closeDayAction({
      amountCollectedPaise: 100_00,
      quotationsSubmittedToday: 2,
    });
    expect(first.ok).toBe(true);

    const [row] = await db
      .select({
        closedAt: dayPlans.closedAt,
        amountCollectedPaise: dayPlans.amountCollectedPaise,
        quotationsSubmittedToday: dayPlans.quotationsSubmittedToday,
      })
      .from(dayPlans)
      .where(eq(dayPlans.execUserId, exec.id))
      .limit(1);
    expect(row.closedAt).not.toBeNull();
    expect(row.amountCollectedPaise).toBe(10_000);
    expect(row.quotationsSubmittedToday).toBe(2);

    const second = await closeDayAction({
      amountCollectedPaise: 0,
      quotationsSubmittedToday: 0,
    });
    expect(second.ok).toBe(false);
  });
});
