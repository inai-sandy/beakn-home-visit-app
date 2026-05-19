import { format } from 'date-fns';
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { LeadAvatar } from '@/components/leads/LeadAvatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { db } from '@/db/client';
import {
  businessTypes,
  cities,
  dayPlans,
  leads,
  quotations,
  statusStages,
  users,
  visitRequests,
} from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { loadExecVisibleContactSet } from '@/lib/exec/visible-contacts';
import { getIstDateString } from '@/lib/today/time';

import {
  ContactRequestsSection,
  type ContactRequestRow,
} from './_components/ContactRequestsSection';
import { LeadQuickActions } from './_components/LeadQuickActions';
import { CreateTaskFromLeadButton } from './_components/CreateTaskFromLeadButton';

// =============================================================================
// HVA-73 follow-up + PR 1: /leads/[leadId] — contact detail
// =============================================================================
//
// Header (avatar + name + type + city), quick-action row (WhatsApp /
// Email / Call), then the NEW Requests section listing every request
// linked to this contact. Plan-a-Visit moved into that section's header
// per PR 1 D2.
//
// Requests query union: rows where `visit_requests.contact_id = lead.id`
// (the canonical lookup for new conversions) PLUS the legacy
// `leads.converted_to_request_id` pointer (no backfill — D6) so contacts
// converted before PR 1 still surface their single request.
//
// AUTH:
//   - sales_executive: must be the captor of this lead.
//   - super_admin:     can view any lead.
//   - other roles:     redirected back to /login.
// =============================================================================

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ leadId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { leadId } = await params;
  return {
    title: 'Contact — Beakn',
    description: `Contact ${leadId.slice(0, 8)}`,
  };
}

export default async function LeadDetailPage({ params }: PageProps) {
  const { leadId } = await params;
  const session = await getServerSession();
  if (!session) redirect(`/login?next=/leads/${leadId}`);

  const user = session.user as { id: string; role?: string };
  if (user.role === 'captain') redirect('/captain/dashboard');
  if (user.role !== 'sales_executive' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const [row] = await db
    .select({
      id: leads.id,
      type: leads.type,
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      cityId: leads.cityId,
      cityName: cities.name,
      bhk: leads.bhk,
      firmName: leads.firmName,
      businessTypeId: leads.businessTypeId,
      businessTypeName: businessTypes.name,
      interest: leads.interest,
      notes: leads.notes,
      capturedByUserId: leads.capturedByUserId,
      capturedByName: users.fullName,
      capturedDate: leads.capturedDate,
      createdAt: leads.createdAt,
      convertedToRequestId: leads.convertedToRequestId,
      convertedAt: leads.convertedAt,
    })
    .from(leads)
    .innerJoin(cities, eq(cities.id, leads.cityId))
    .leftJoin(businessTypes, eq(businessTypes.id, leads.businessTypeId))
    .innerJoin(users, eq(users.id, leads.capturedByUserId))
    .where(eq(leads.id, leadId))
    .limit(1);

  if (!row) notFound();

  // HVA-73 PR 3: visibility broadens beyond captor — exec sees the
  // contact if they are currently or have ever been assigned to a
  // contact-linked request. Compute the set once and reuse for the
  // auth gate + the AddTaskSheet's lead picker below.
  const visibility =
    user.role === 'super_admin'
      ? null
      : await loadExecVisibleContactSet(user.id);
  if (visibility && !visibility.reasons.has(row.id)) {
    notFound();
  }
  const visibilityReason: 'captor' | 'assignment' =
    user.role === 'super_admin'
      ? row.capturedByUserId === user.id
        ? 'captor'
        : 'assignment'
      : (visibility!.reasons.get(row.id) ?? 'captor');

  const isBusiness = row.type === 'Business';
  const converted = row.convertedToRequestId !== null;

  const istDate = getIstDateString();
  const [plan] = await db
    .select({ id: dayPlans.id, closedAt: dayPlans.closedAt })
    .from(dayPlans)
    .where(and(eq(dayPlans.execUserId, user.id), eq(dayPlans.planDate, istDate)))
    .limit(1);
  const dayPlanReady = Boolean(plan && plan.closedAt === null);

  // -------------------------------------------------------------------------
  // Requests list: union of (contact_id = leadId) and the legacy
  // converted_to_request_id pointer. Drizzle's `or` lets us express this
  // in a single round-trip; deduplication happens at the SQL level since
  // the same request id can't appear twice.
  // -------------------------------------------------------------------------
  const requestWhere = converted && row.convertedToRequestId
    ? or(
        eq(visitRequests.contactId, leadId),
        eq(visitRequests.id, row.convertedToRequestId),
      )
    : eq(visitRequests.contactId, leadId);

  const execAlias = users;
  const contactRequestRows = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      cityName: cities.name,
      statusStageCode: statusStages.code,
      statusStageName: statusStages.name,
      assignedExecName: execAlias.fullName,
      totalAmountPaise: quotations.totalOrderValuePaise,
      createdAt: visitRequests.createdAt,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .leftJoin(execAlias, eq(execAlias.id, visitRequests.assignedExecUserId))
    .leftJoin(quotations, eq(quotations.visitRequestId, visitRequests.id))
    .where(requestWhere)
    .orderBy(desc(visitRequests.createdAt));

  const contactRequests: ContactRequestRow[] = contactRequestRows.map((r) => ({
    id: r.id,
    customerName: r.customerName,
    cityName: r.cityName,
    statusStageCode: r.statusStageCode,
    statusStageName: r.statusStageName,
    assignedExecName: r.assignedExecName ?? null,
    totalAmountPaise: r.totalAmountPaise ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

  // HVA-73 PR 3: linkableLeads broadens to the visible-set. For
  // super_admin the visibility variable is null; fall back to "all
  // unconverted captor-of-record" which preserves the previous behaviour
  // (an admin's lead-link picker doesn't surface anybody else's pool).
  const visibleIdsForPicker = visibility?.ids ?? [];
  const [linkableRequestsRows, linkableLeadsRows] = await Promise.all([
    db
      .select({
        id: visitRequests.id,
        customerName: visitRequests.customerName,
        customerPhone: visitRequests.customerPhone,
      })
      .from(visitRequests)
      .where(eq(visitRequests.assignedExecUserId, user.id))
      .orderBy(asc(visitRequests.createdAt))
      .limit(20),
    visibility === null
      ? db
          .select({ id: leads.id, name: leads.name, phone: leads.phone })
          .from(leads)
          .where(
            and(
              eq(leads.capturedByUserId, user.id),
              isNull(leads.convertedToRequestId),
            ),
          )
          .orderBy(asc(leads.createdAt))
          .limit(20)
      : visibleIdsForPicker.length === 0
        ? Promise.resolve(
            [] as Array<{ id: string; name: string; phone: string }>,
          )
        : db
            .select({ id: leads.id, name: leads.name, phone: leads.phone })
            .from(leads)
            .where(
              and(
                inArray(leads.id, visibleIdsForPicker),
                isNull(leads.convertedToRequestId),
              ),
            )
            .orderBy(asc(leads.createdAt))
            .limit(20),
  ]);

  const leadForActions = {
    id: row.id,
    type: row.type,
    name: row.name,
    phone: row.phone,
    email: row.email,
    cityName: row.cityName,
    bhk: row.bhk,
    firmName: row.firmName,
    businessTypeName: row.businessTypeName,
    interest: row.interest,
  };

  return (
    <main className="min-h-svh bg-background pb-24">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-5 space-y-5">
        {/* Header: back + avatar + name */}
        <div className="space-y-4">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href="/leads">
              <Icon name="arrow_back" size="sm" />
              Contacts
            </Link>
          </Button>

          <div className="flex items-start gap-4">
            <LeadAvatar name={row.name} size="lg" aria-hidden />
            <div className="min-w-0 flex-1 space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">{row.name}</h1>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`size-1.5 rounded-full ${
                      isBusiness ? 'bg-amber-500' : 'bg-teal-500'
                    }`}
                    aria-hidden
                  />
                  {row.type}
                </span>
                <span aria-hidden>·</span>
                <span>{row.cityName}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick actions — WhatsApp / Email / Call only (PR 1: Plan a
            Visit moved into the Requests section). */}
        <LeadQuickActions
          name={row.name}
          phone={row.phone}
          email={row.email}
        />

        {/* Requests section (HVA-73 PR 1) */}
        <ContactRequestsSection lead={leadForActions} requests={contactRequests} />

        {/* Details */}
        <section
          aria-label="Details"
          className="rounded-2xl border bg-card p-4 space-y-3"
        >
          <DetailRow label="Phone" value={row.phone} mono />
          {row.email && <DetailRow label="Email" value={row.email} />}
          <DetailRow label="City" value={row.cityName} />
          {row.interest.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Interests</p>
              <div className="flex flex-wrap gap-1.5">
                {row.interest.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px]">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {!isBusiness && row.bhk && <DetailRow label="BHK" value={row.bhk} />}
          {isBusiness && row.firmName && (
            <DetailRow label="Firm" value={row.firmName} />
          )}
          {isBusiness && row.businessTypeName && (
            <DetailRow label="Business type" value={row.businessTypeName} />
          )}
          {row.notes && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Notes</p>
              <p className="text-sm whitespace-pre-line">{row.notes}</p>
            </div>
          )}
        </section>

        {/* Captured-by */}
        <p className="text-xs text-muted-foreground">
          Captured by {row.capturedByName ?? '—'} on{' '}
          {format(new Date(row.createdAt), 'd MMM yyyy')}
        </p>

        {/* Bottom action: Create Task in Day Sheet (Plan a Visit lives
            in the Requests section header). */}
        <CreateTaskFromLeadButton
          lead={{ id: row.id, name: row.name }}
          linkableRequests={linkableRequestsRows}
          linkableLeads={linkableLeadsRows}
          dayPlanReady={dayPlanReady}
        />
      </div>
    </main>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={mono ? 'text-sm font-mono' : 'text-sm'}>{value}</p>
    </div>
  );
}
