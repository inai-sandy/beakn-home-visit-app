import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { quickAddLeadAction } from '@/app/(exec)/leads/_actions/addLead';
import { db } from '@/db/client';
import { leads } from '@/db/schema';

import { loginByPhone } from '../helpers/auth';
import { getOrCreateCity, seedCaptain, seedExecutive } from '../helpers/db';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

// =============================================================================
// HVA-273: Quick Capture action tests
// =============================================================================
//
// D1-D4 contracts:
//   - name + phone only; type defaults Customer; interests empty
//   - city comes from sales_executives.city_id (D3)
//   - duplicate phone: error='duplicate'; own contact exposes
//     dupLeadId/dupName, someone else's does not (D4)
// =============================================================================

async function seedExecInCity(phone: string) {
  const captain = await seedCaptain({ phone: `+9199100${phone.slice(-5)}` });
  const city = await getOrCreateCity('Bangalore');
  const exec = await seedExecutive(captain.id, { phone });
  // seedExecutive doesn't set city_id — Quick Capture needs it (D3).
  await db.execute(
    // eslint-disable-next-line no-restricted-syntax -- raw update keeps the helper untouched
    (await import('drizzle-orm')).sql`
      UPDATE sales_executives SET city_id = ${city.id} WHERE user_id = ${exec.id}
    `,
  );
  return { exec, cityId: city.id };
}

describe('quickAddLeadAction', () => {
  it('creates a Customer lead with the exec own city from just name + phone', async () => {
    const { exec, cityId } = await seedExecInCity('+919930000001');
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const r = await quickAddLeadAction({ name: 'Ramesh Kumar', phone: '9876512345' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const [row] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, r.data!.leadId));
    expect(row!.name).toBe('Ramesh Kumar');
    expect(row!.phone).toBe('+919876512345');
    expect(row!.type).toBe('Customer');
    expect(row!.cityId).toBe(cityId);
    expect(row!.interest).toEqual([]);
    expect(row!.capturedByUserId).toBe(exec.id);
  });

  it('duplicate phone captured by the SAME exec returns dupLeadId + dupName', async () => {
    const { exec } = await seedExecInCity('+919930000002');
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const first = await quickAddLeadAction({ name: 'Suresh Babu', phone: '9876512346' });
    expect(first.ok).toBe(true);

    const second = await quickAddLeadAction({ name: 'Someone Else', phone: '9876512346' });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe('duplicate');
    expect(second.fieldErrors?.dupName).toBe('Suresh Babu');
    expect(second.fieldErrors?.dupLeadId).toBeDefined();

    // No duplicate row created.
    const rows = await db
      .select({ id: leads.id })
      .from(leads)
      .where(eq(leads.phone, '+919876512346'));
    expect(rows).toHaveLength(1);
  });

  it("duplicate phone captured by ANOTHER exec returns duplicate WITHOUT the contact's identity", async () => {
    const a = await seedExecInCity('+919930000003');
    const b = await seedExecInCity('+919930000004');

    const sessA = await loginByPhone(a.exec.phone, a.exec.password);
    currentCookieHeader = sessA.cookieHeader;
    const first = await quickAddLeadAction({ name: 'Private Contact', phone: '9876512347' });
    expect(first.ok).toBe(true);

    const sessB = await loginByPhone(b.exec.phone, b.exec.password);
    currentCookieHeader = sessB.cookieHeader;
    const second = await quickAddLeadAction({ name: 'Attempt Two', phone: '9876512347' });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe('duplicate');
    expect(second.fieldErrors?.dupLeadId).toBeUndefined();
    expect(second.fieldErrors?.dupName).toBeUndefined();
  });

  it('rejects invalid phone shapes', async () => {
    const { exec } = await seedExecInCity('+919930000005');
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const r = await quickAddLeadAction({ name: 'Bad Phone', phone: '12345' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors?.phone).toBeDefined();
  });

  it('captain (no sales_executives row) is refused with a helpful message', async () => {
    const captain = await seedCaptain({ phone: '+919930000006' });
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const r = await quickAddLeadAction({ name: 'Captain Try', phone: '9876512348' });
    expect(r.ok).toBe(false);
  });
});
