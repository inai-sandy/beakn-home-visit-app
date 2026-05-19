import { format } from 'date-fns';
import { and, asc, eq, isNull } from 'drizzle-orm';
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
  users,
  visitRequests,
} from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { getIstDateString } from '@/lib/today/time';

import { LeadQuickActions } from './_components/LeadQuickActions';
import { CreateTaskFromLeadButton } from './_components/CreateTaskFromLeadButton';
import { PlanVisitButton } from './_components/PlanVisitButton';

// =============================================================================
// HVA-73 follow-up: /leads/[leadId] — lead detail
// =============================================================================
//
// Contact-book style header (large avatar + name + type + city), big
// quick-action row, detail fields, then two primary CTAs:
//
//   - Plan a Visit  → opens ConvertLeadSheet (existing component, unchanged)
//   - Create Task in Day Sheet → opens AddTaskSheet preconfigured with
//                   linkLeadId = this lead. Disabled when no day plan
//                   exists for today.
//
// AUTH:
//   - sales_executive: must be the captor of this lead.
//   - super_admin:     can view any lead (read-only is fine; conversion
//                     still allowed per HVA-74's super-admin override).
//   - other roles:     redirected back to /login.
// =============================================================================

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ leadId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { leadId } = await params;
  return {
    title: 'Lead — Beakn',
    // We intentionally don't surface the lead name in the title to keep
    // PII out of browser history. The page header carries the name.
    description: `Lead ${leadId.slice(0, 8)}`,
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

  // Ownership: sales_executive can only see their own captured leads.
  // super_admin override per HVA-74 spec.
  if (user.role !== 'super_admin' && row.capturedByUserId !== user.id) {
    notFound();
  }

  const converted = row.convertedToRequestId !== null;
  const isBusiness = row.type === 'Business';

  // Day-plan presence drives whether the "Create Task in Day Sheet"
  // button is enabled. We don't auto-create a plan (bundle DO NOT #3).
  const istDate = getIstDateString();
  const [plan] = await db
    .select({ id: dayPlans.id, closedAt: dayPlans.closedAt })
    .from(dayPlans)
    .where(and(eq(dayPlans.execUserId, user.id), eq(dayPlans.planDate, istDate)))
    .limit(1);
  const dayPlanReady = Boolean(plan && plan.closedAt === null);

  // Fetch the same linkable pools the /today FAB uses so the AddTaskSheet
  // (open from this lead detail) has them available even though search is
  // hidden. Keeps the component's contract simple: it always receives the
  // arrays; preselectedLink decides whether to render search.
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
    db
      .select({ id: leads.id, name: leads.name, phone: leads.phone })
      .from(leads)
      .where(
        and(
          eq(leads.capturedByUserId, user.id),
          isNull(leads.convertedToRequestId),
        ),
      )
      .orderBy(asc(leads.createdAt))
      .limit(20),
  ]);

  return (
    <main className="min-h-svh bg-background pb-24">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-5 space-y-6">
        {/* Header: back + avatar + name */}
        <div className="space-y-4">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href="/leads">
              <Icon name="arrow_back" size="sm" />
              Leads
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
                {converted && (
                  <Badge variant="outline" className="text-[10px] ml-1">
                    <Icon name="check_circle" size="xs" className="mr-1" />
                    Converted
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Quick actions — 3 big buttons */}
        <LeadQuickActions
          name={row.name}
          phone={row.phone}
          email={row.email}
        />

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

        {/* Action footer */}
        {converted && row.convertedToRequestId ? (
          <div className="rounded-2xl border bg-muted/40 p-4 space-y-3">
            <p className="text-sm">
              This lead has been converted to a request.
            </p>
            <Button asChild className="w-full" size="lg">
              <Link href={`/requests/${row.convertedToRequestId}`}>
                <Icon name="arrow_forward" size="sm" />
                Open request
              </Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <PlanVisitButton lead={row} />
            <CreateTaskFromLeadButton
              lead={{ id: row.id, name: row.name }}
              linkableRequests={linkableRequestsRows}
              linkableLeads={linkableLeadsRows}
              dayPlanReady={dayPlanReady}
            />
          </div>
        )}
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
