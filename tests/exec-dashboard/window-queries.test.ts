import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { leads, tasks } from '@/db/schema';
import {
  loadExecContactsCaptured,
  loadExecTaskWindowCounts,
} from '@/lib/exec/dashboard-queries';
import { getIstDateString } from '@/lib/today/time';

import { getOrCreateCity, seedCaptain, seedExecutive } from '../helpers/db';

// =============================================================================
// HVA-277: window-driven tile queries
// =============================================================================
//
// The redesign contract is that every tile obeys the from/to picker.
// These tests pin the two non-SSOT helpers to that contract: counts
// inside the window appear, counts outside it don't.
// =============================================================================

const istToday = getIstDateString();

function offset(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

describe('loadExecTaskWindowCounts', () => {
  it('counts done/total inside the window only, all task types', async () => {
    const captain = await seedCaptain({ phone: '+919000277001' });
    const exec = await seedExecutive(captain.id, { phone: '+919100277001' });

    await db.insert(tasks).values([
      // in window: 1 done + 1 pending
      {
        execUserId: exec.id,
        taskType: 'Follow-up',
        description: 'in-window done',
        estimatedTime: '30min',
        taskDate: offset(istToday, -3),
        status: 'completed',
      },
      {
        execUserId: exec.id,
        taskType: 'Customer home visit',
        description: 'in-window pending',
        estimatedTime: '1hr',
        taskDate: offset(istToday, -1),
        status: 'pending',
      },
      // outside window
      {
        execUserId: exec.id,
        taskType: 'Sales pitch',
        description: 'too old',
        estimatedTime: '30min',
        taskDate: offset(istToday, -20),
        status: 'completed',
      },
    ]);

    const counts = await loadExecTaskWindowCounts(
      exec.id,
      offset(istToday, -7),
      istToday,
    );
    expect(counts).toEqual({ done: 1, total: 2 });
  });
});

describe('loadExecContactsCaptured', () => {
  it('counts only leads captured by this exec with created_at in the IST window', async () => {
    const captain = await seedCaptain({ phone: '+919000277002' });
    const execA = await seedExecutive(captain.id, { phone: '+919100277002' });
    const execB = await seedExecutive(captain.id, { phone: '+919100277003' });
    const city = await getOrCreateCity('Hyderabad');

    await db.insert(leads).values([
      {
        name: 'Window Lead',
        phone: '+919876527701',
        type: 'Customer',
        interest: [],
        cityId: city.id,
        capturedByUserId: execA.id,
      },
      {
        name: 'Other Exec Lead',
        phone: '+919876527702',
        type: 'Customer',
        interest: [],
        cityId: city.id,
        capturedByUserId: execB.id,
      },
    ]);

    const inWindow = await loadExecContactsCaptured(
      execA.id,
      offset(istToday, -7),
      istToday,
    );
    expect(inWindow).toBe(1);

    // A window that ends before today excludes the just-created lead.
    const pastWindow = await loadExecContactsCaptured(
      execA.id,
      offset(istToday, -14),
      offset(istToday, -8),
    );
    expect(pastWindow).toBe(0);
  });
});
