import { asc, eq, gte } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  cities,
  quotationLineItems,
  quotations,
  statusStages,
  visitRequests,
} from '@/db/schema';

// =============================================================================
// HVA-247: filter dropdown option loaders for the 4 support pages
// =============================================================================
//
// Lists of:
//   - all cities (full table; ~8 rows)
//   - DISTINCT product names from line items on ORDER_CONFIRMED+ requests
//   - DISTINCT (customer name + phone) from ORDER_CONFIRMED+ requests
//
// Scope = orders only (status_stage.sequence_number >= 6) so dropdowns
// don't fill up with pre-quotation lead data.
// =============================================================================

const ORDER_CONFIRMED_SEQ = 6;

export interface CityOption {
  id: string;
  name: string;
}

export interface ProductOption {
  name: string;
}

export interface CustomerOption {
  phone: string;
  name: string;
}

export interface SupportFilterOptions {
  cities: CityOption[];
  products: ProductOption[];
  customers: CustomerOption[];
}

export async function loadSupportFilterOptions(): Promise<SupportFilterOptions> {
  const [cityRows, productRows, customerRows] = await Promise.all([
    db
      .select({ id: cities.id, name: cities.name })
      .from(cities)
      .orderBy(asc(cities.name)),

    db
      .selectDistinct({ name: quotationLineItems.productName })
      .from(quotationLineItems)
      .innerJoin(quotations, eq(quotations.id, quotationLineItems.quotationId))
      .innerJoin(
        visitRequests,
        eq(visitRequests.id, quotations.visitRequestId),
      )
      .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
      .where(gte(statusStages.sequenceNumber, ORDER_CONFIRMED_SEQ))
      .orderBy(asc(quotationLineItems.productName)),

    db
      .selectDistinct({
        phone: visitRequests.customerPhone,
        name: visitRequests.customerName,
      })
      .from(visitRequests)
      .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
      .where(gte(statusStages.sequenceNumber, ORDER_CONFIRMED_SEQ))
      .orderBy(asc(visitRequests.customerName)),
  ]);

  return {
    cities: cityRows,
    products: productRows,
    customers: customerRows,
  };
}
