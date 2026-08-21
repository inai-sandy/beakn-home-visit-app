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
  /** A sample assigned visit_request that's visible to both captain
   *  (in /captain/requests) and exec (in /requests). HVA-198 PR-B uses
   *  it to verify the list views render + the request detail page
   *  loads. */
  sampleRequest: { id: string; customerName: string; trackingToken: string };
  /** HVA-261: a SUBMITTED, fully-unassigned request reserved for the
   *  golden-journey spec — it walks assignment → scheduling →
   *  quotation → payment → ticket via the real UI, so it must start
   *  untouched. Other specs must NOT mutate this row. */
  journeyRequest: { id: string; customerName: string; trackingToken: string };
  /** HVA-314: parked at VISIT_COMPLETED with NO quotation — the advance to
   *  Quotation Given must render disabled. */
  gateQuotationRequest: { id: string; customerName: string; trackingToken: string };
  /** HVA-317: parked at ORDER_CONFIRMED — advancing must open the date
   *  picker rather than moving the stage in one tap. */
  gateInstallRequest: { id: string; customerName: string; trackingToken: string };
  /** HVA-341: parked at QUOTATION_GIVEN WITH a CartPlus quotation — the
   *  advance to Order Confirmed must render disabled, because only CartPlus
   *  confirms orders. The quotation matters: without it the refusal could be
   *  the HVA-314 gate rather than this one. */
  gateConfirmRequest: { id: string; customerName: string; trackingToken: string };
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

    // A sample visit_request that's already assigned to Veera + Arjun
    // so both the captain and exec requests list pages render with at
    // least one row. Status is ASSIGNED (sequence 2) — past the
    // "unassigned" bucket but pre-visit.
    const [assignedStage] = await sql<{ id: string }[]>`
      SELECT id FROM status_stages WHERE code = 'ASSIGNED' LIMIT 1
    `;
    if (!assignedStage) {
      throw new Error(
        'status_stages seed missing — ASSIGNED row not present. Migrations may be incomplete.',
      );
    }
    const [request] = await sql<{ id: string; tracking_token: string }[]>`
      INSERT INTO visit_requests (
        customer_name, customer_phone, address, city_id,
        bhk, interest, tracking_token, source,
        status_stage_id, assigned_exec_user_id, assigned_captain_user_id, assigned_at
      ) VALUES (
        'E2E Customer', '+919876500001', '123 Test Lane, Hyderabad', ${city.id},
        '3BHK'::bhk_type, '["Complete Lighting"]'::jsonb, 'e2etoken1234567890abcd', 'web',
        ${assignedStage.id}, ${veeraId}, ${arjunId}, NOW()
      )
      RETURNING id, tracking_token
    `;

    // HVA-261: golden-journey starting point — SUBMITTED, unassigned.
    const [submittedStage] = await sql<{ id: string }[]>`
      SELECT id FROM status_stages WHERE code = 'SUBMITTED' LIMIT 1
    `;
    if (!submittedStage) {
      throw new Error(
        'status_stages seed missing — SUBMITTED row not present. Migrations may be incomplete.',
      );
    }
    const [journey] = await sql<{ id: string; tracking_token: string }[]>`
      INSERT INTO visit_requests (
        customer_name, customer_phone, address, city_id,
        bhk, interest, tracking_token, source, status_stage_id
      ) VALUES (
        'Journey Customer', '+919876500002', '42 Golden Path, Hyderabad', ${city.id},
        '2BHK'::bhk_type, '["Complete Lighting"]'::jsonb, 'e2ejourney1234567890ab', 'web',
        ${submittedStage.id}
      )
      RETURNING id, tracking_token
    `;

    // HVA-321/HVA-314/HVA-317: two requests parked at the stages the workflow
    // GATES guard, so tests/e2e/workflow-gates.spec.ts can assert in a real
    // browser that the buttons refuse.
    //
    // This is the gap that produced the whole batch: the suite asserted that
    // functions return what the code intends, and nothing asserted that a
    // person in a role sees and can use the right control on screen. Both are
    // assigned to the exec so they show up on their request list.
    const [visitCompletedStage] = await sql<{ id: string }[]>`
      SELECT id FROM status_stages WHERE code = 'VISIT_COMPLETED' LIMIT 1
    `;
    const [orderConfirmedStage] = await sql<{ id: string }[]>`
      SELECT id FROM status_stages WHERE code = 'ORDER_CONFIRMED' LIMIT 1
    `;
    const [quotationGivenStage] = await sql<{ id: string }[]>`
      SELECT id FROM status_stages WHERE code = 'QUOTATION_GIVEN' LIMIT 1
    `;
    if (!visitCompletedStage || !orderConfirmedStage) {
      throw new Error(
        'status_stages seed missing — VISIT_COMPLETED / ORDER_CONFIRMED absent. Migrations may be incomplete.',
      );
    }

    // Deliberately has NO quotation: that is exactly the state where the
    // advance to Quotation Given must be refused.
    const [gateQuotation] = await sql<{ id: string; tracking_token: string }[]>`
      INSERT INTO visit_requests (
        customer_name, customer_phone, address, city_id,
        bhk, interest, tracking_token, source,
        status_stage_id, assigned_exec_user_id, assigned_captain_user_id, assigned_at
      ) VALUES (
        'Gate Quotation Customer', '+919876500003', '7 Gate Road, Hyderabad', ${city.id},
        '2BHK'::bhk_type, '["Complete Lighting"]'::jsonb, 'e2egatequote123456789a', 'web',
        ${visitCompletedStage.id}, ${veeraId}, ${arjunId}, NOW()
      )
      RETURNING id, tracking_token
    `;

    const [gateInstall] = await sql<{ id: string; tracking_token: string }[]>`
      INSERT INTO visit_requests (
        customer_name, customer_phone, address, city_id,
        bhk, interest, tracking_token, source,
        status_stage_id, assigned_exec_user_id, assigned_captain_user_id, assigned_at
      ) VALUES (
        'Gate Install Customer', '+919876500004', '9 Gate Road, Hyderabad', ${city.id},
        '3BHK'::bhk_type, '["Automation"]'::jsonb, 'e2egateinstall12345678', 'web',
        ${orderConfirmedStage.id}, ${veeraId}, ${arjunId}, NOW()
      )
      RETURNING id, tracking_token
    `;

    // The install-gate request needs a quotation to be a realistic
    // ORDER_CONFIRMED row (it got there through CartPlus in real life).
    await sql`
      INSERT INTO quotations (
        visit_request_id, quotation_number, total_order_value_paise,
        submitted_by_user_id, source, portal_quotation_id, store_id, last_webhook_at
      ) VALUES (
        ${gateInstall.id}, 'CP-GATE-1', 2500000,
        ${veeraId}, 'portal', 'gate-portal-1', 1, NOW()
      )
    `;

    // HVA-342: give the confirmed order real line items, so the exec's
    // dispatch pick list has something to offer. Attached to an EXISTING
    // fixture rather than a new request on purpose — a new row would shift
    // the exec + captain request-list visual baselines, which is exactly
    // what HVA-341's fixture did.
    await sql`
      INSERT INTO quotation_line_items (
        quotation_id, position, product_name, product_sku,
        quantity, unit_price_paise, line_total_paise, priority
      )
      SELECT q.id, v.position, v.product_name, v.sku,
             v.qty, v.unit_price, v.qty * v.unit_price, 'med'::line_item_priority
      FROM quotations q
      CROSS JOIN (VALUES
        (1, 'Smart Door Lock', 'SDL-100', 2, 900000),
        (2, 'Motion Sensor',   'MS-200',  3, 233333)
      ) AS v(position, product_name, sku, qty, unit_price)
      WHERE q.quotation_number = 'CP-GATE-1'
    `;

    // HVA-341: parked at Quotation Given, WITH a quotation, so the only thing
    // standing between it and Order Confirmed is the system_only gate. If the
    // quotation were missing the disabled button would prove nothing — the
    // HVA-314 gate would refuse it first, for a different reason.
    const [gateConfirm] = await sql<{ id: string; tracking_token: string }[]>`
      INSERT INTO visit_requests (
        customer_name, customer_phone, address, city_id,
        bhk, interest, tracking_token, source,
        status_stage_id, assigned_exec_user_id, assigned_captain_user_id, assigned_at
      ) VALUES (
        'Gate Confirm Customer', '+919876500005', '11 Gate Road, Hyderabad', ${city.id},
        '3BHK'::bhk_type, '["Automation"]'::jsonb, 'e2egateconfirm1234567a', 'web',
        ${quotationGivenStage!.id}, ${veeraId}, ${arjunId}, NOW()
      )
      RETURNING id, tracking_token
    `;
    await sql`
      INSERT INTO quotations (
        visit_request_id, quotation_number, total_order_value_paise,
        submitted_by_user_id, source, portal_quotation_id, store_id, last_webhook_at
      ) VALUES (
        ${gateConfirm.id}, 'CP-GATE-2', 1800000,
        ${veeraId}, 'portal', 'gate-portal-2', 1, NOW()
      )
    `;

    // HVA-281: the journey's order carries a CartPlus (portal) quotation —
    // real quotations now come from CartPlus; a Beakn request carries only
    // a Target. The order/collection steps run against this synced
    // quotation (₹50,000), while the exec sets a separate Target in step 3.
    await sql`
      INSERT INTO quotations (
        visit_request_id, quotation_number, total_order_value_paise,
        submitted_by_user_id, source, portal_quotation_id, store_id, last_webhook_at
      ) VALUES (
        ${journey.id}, 'CP-GOLDEN-1', 5000000,
        ${veeraId}, 'portal', 'golden-portal-1', 1, NOW()
      )
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
      sampleRequest: {
        id: request.id,
        customerName: 'E2E Customer',
        trackingToken: request.tracking_token,
      },
      journeyRequest: {
        id: journey.id,
        customerName: 'Journey Customer',
        trackingToken: journey.tracking_token,
      },
      gateQuotationRequest: {
        id: gateQuotation.id,
        customerName: 'Gate Quotation Customer',
        trackingToken: gateQuotation.tracking_token,
      },
      gateConfirmRequest: {
        id: gateConfirm.id,
        customerName: 'Gate Confirm Customer',
        trackingToken: gateConfirm.tracking_token,
      },
      gateInstallRequest: {
        id: gateInstall.id,
        customerName: 'Gate Install Customer',
        trackingToken: gateInstall.tracking_token,
      },
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
