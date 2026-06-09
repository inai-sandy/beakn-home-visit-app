import { asc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { supportTicketCategories } from '@/db/schema';

// =============================================================================
// HVA-256-FIX1: admin-configurable ticket categories
// =============================================================================
//
// Two consumers:
//   - public /track form + internal /tickets queue → loadActiveCategories
//     (deactivated categories don't appear in the dropdown)
//   - admin CRUD page → loadAllCategories (admin sees inactive too)
// =============================================================================

export interface TicketCategoryRow {
  id: string;
  code: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}

export async function loadActiveCategories(): Promise<TicketCategoryRow[]> {
  return db
    .select({
      id: supportTicketCategories.id,
      code: supportTicketCategories.code,
      name: supportTicketCategories.name,
      displayOrder: supportTicketCategories.displayOrder,
      isActive: supportTicketCategories.isActive,
    })
    .from(supportTicketCategories)
    .where(eq(supportTicketCategories.isActive, true))
    .orderBy(asc(supportTicketCategories.displayOrder));
}

export async function loadAllCategories(): Promise<TicketCategoryRow[]> {
  return db
    .select({
      id: supportTicketCategories.id,
      code: supportTicketCategories.code,
      name: supportTicketCategories.name,
      displayOrder: supportTicketCategories.displayOrder,
      isActive: supportTicketCategories.isActive,
    })
    .from(supportTicketCategories)
    .orderBy(asc(supportTicketCategories.displayOrder));
}

export async function loadActiveCategoryCodes(): Promise<string[]> {
  const rows = await loadActiveCategories();
  return rows.map((r) => r.code);
}
