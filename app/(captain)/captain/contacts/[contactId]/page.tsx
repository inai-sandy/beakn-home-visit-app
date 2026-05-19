import { format, formatDistanceToNow } from 'date-fns';
import { asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { LeadAvatar } from '@/components/leads/LeadAvatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { db } from '@/db/client';
import { businessTypes as businessTypesTable, cities } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { isRole, type Role } from '@/lib/auth/roles';
import { canCaptainEditContact } from '@/lib/captain/edit-auth';
import {
  fetchTeamContactById,
  fetchTeamContactRequests,
  loadCaptainTeamUserIds,
  type TeamContactRequest,
} from '@/lib/captain/contacts-queries';
import {
  canWriteNoteForEntity,
  loadNotesForEntity,
} from '@/lib/notes/queries';
import { cn } from '@/lib/utils';

import { NotesSection } from '@/components/notes/NotesSection';

// HVA-163: reuse the exec-portal EditContactSheet via its launcher button.
// Next route groups are virtual — cross-group imports work at runtime
// and the component is purely client-side stateful + server-action plumbing.
import { EditContactButton } from '@/app/(exec)/leads/[leadId]/_components/EditContactButton';

import { CaptainContactQuickActions } from './_components/CaptainContactQuickActions';

// =============================================================================
// HVA-73 PR 2: /captain/contacts/[contactId] — captain-scoped detail
// =============================================================================
//
// Mirrors the exec detail layout (PR 1) with two differences (D5):
//   - Captured-by line surfaced in the header
//   - Each request card shows "Assigned to: <exec name>"
//
// Captain-only, read-only. NO Plan a Visit, NO Create Task buttons. Edit
// arrives in PR 3.
//
// Auth scope: contact must be captured by a member of this captain's team
// (sales_executives.captain_user_id = currentCaptain.id). Otherwise 404 —
// we don't reveal existence to off-team captains.
// =============================================================================

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ contactId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { contactId } = await params;
  return {
    title: 'Contact — Captain',
    description: `Contact ${contactId.slice(0, 8)}`,
  };
}

const STATUS_BADGE_VARIANT: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  SUBMITTED: 'secondary',
  ASSIGNED: 'default',
  VISIT_SCHEDULED: 'default',
  VISIT_COMPLETED: 'default',
  QUOTATION_SENT: 'default',
  ORDER_CONFIRMED: 'default',
  ORDER_EXECUTED_SUCCESSFULLY: 'default',
  PENDING_CAPTAIN_APPROVAL: 'secondary',
  REJECTED: 'destructive',
  CUSTOMER_REJECTED: 'destructive',
  CANCELLED: 'destructive',
};

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export default async function CaptainContactDetailPage({ params }: PageProps) {
  const { contactId } = await params;
  const session = await getServerSession();
  if (!session) redirect(`/login?next=/captain/contacts/${contactId}`);

  const user = session.user as { id: string; role?: string };
  if (user.role !== 'captain' && user.role !== 'super_admin') {
    redirect('/login');
  }

  // super_admin doesn't have a team; for support they can still pass
  // through by treating their team as "any team", but per D6 we 404 for
  // non-team contacts. Strict scope here keeps the rule simple — if
  // admins need broader access they can use /exec/leads/[leadId] which
  // already allows the super_admin override.
  const teamUserIds =
    user.role === 'captain' ? await loadCaptainTeamUserIds(user.id) : [];
  if (teamUserIds.length === 0) notFound();

  const contact = await fetchTeamContactById(contactId, teamUserIds);
  if (!contact) notFound();

  const requests = await fetchTeamContactRequests(
    contact.id,
    contact.convertedToRequestId,
  );

  const isBusiness = contact.type === 'Business';
  const converted = contact.convertedToRequestId !== null;

  // HVA-73 PR 3: notes section.
  const role = user.role;
  const [notesForContact, canWriteContactNote] = await Promise.all([
    loadNotesForEntity('contact', contact.id),
    isRole(role)
      ? canWriteNoteForEntity({ id: user.id, role }, 'contact', contact.id)
      : Promise.resolve(false),
  ]);
  const viewerForNotes: {
    id: string;
    fullName: string | null;
    role: Role;
  } = {
    id: user.id,
    fullName: (user as { fullName?: string; name?: string }).fullName ?? null,
    role: isRole(role) ? role : 'captain',
  };

  // HVA-163: captain edit pencil + dropdown data for EditContactSheet.
  // super_admin shouldn't normally hit this page (they have no team
  // scoped), but if they do via the escape hatch they keep edit access.
  const editable =
    role === 'super_admin' ||
    (role === 'captain' && (await canCaptainEditContact(user.id, contact.id)));
  const [editCityRows, editBusinessTypeRows] = editable
    ? await Promise.all([
        db
          .select({ id: cities.id, name: cities.name })
          .from(cities)
          .where(eq(cities.isActive, true))
          .orderBy(asc(cities.name)),
        db
          .select({
            id: businessTypesTable.id,
            name: businessTypesTable.name,
          })
          .from(businessTypesTable)
          .where(eq(businessTypesTable.isActive, true))
          .orderBy(asc(businessTypesTable.sequenceNumber)),
      ])
    : [[], []];
  const editContactPayload = editable
    ? {
        id: contact.id,
        type: contact.type,
        name: contact.name,
        firmName: contact.firmName,
        phone: contact.phone,
        email: contact.email,
        cityId: contact.cityId,
        bhk: contact.bhk,
        interest: contact.interest,
        businessTypeId: contact.businessTypeId,
        notes: contact.notes,
      }
    : null;

  return (
    <main className="min-h-svh bg-background pb-24">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-5 space-y-5">
        <div className="flex items-center justify-between gap-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href="/captain/contacts">
              <Icon name="arrow_back" size="sm" />
              Contacts
            </Link>
          </Button>
          {editable && editContactPayload && (
            <EditContactButton
              contact={editContactPayload}
              cities={editCityRows}
              businessTypes={editBusinessTypeRows}
            />
          )}
        </div>

        <header className="space-y-4">
          <div className="flex items-start gap-4">
            <LeadAvatar name={contact.name} size="lg" aria-hidden />
            <div className="min-w-0 flex-1 space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">
                {contact.name}
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      isBusiness ? 'bg-amber-500' : 'bg-teal-500',
                    )}
                    aria-hidden
                  />
                  {contact.type}
                </span>
                <span aria-hidden>·</span>
                <span>{contact.cityName}</span>
                {converted && (
                  <Badge variant="outline" className="text-[10px] ml-1">
                    <Icon name="check_circle" size="xs" className="mr-1" />
                    Converted
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground/80">
                Captured by{' '}
                <span className="font-medium">
                  {contact.capturedByName ?? '—'}
                </span>{' '}
                on {format(new Date(contact.createdAt), 'd MMM yyyy')}
              </p>
            </div>
          </div>

          <CaptainContactQuickActions
            name={contact.name}
            phone={contact.phone}
            email={contact.email}
          />
        </header>

        <RequestsSection requests={requests} />

        {/* HVA-73 PR 3: append-only notes timeline for the contact. */}
        <NotesSection
          targetType="contact"
          targetId={contact.id}
          notes={notesForContact}
          canWrite={canWriteContactNote}
          viewer={viewerForNotes}
        />

        <section
          aria-label="Details"
          className="rounded-2xl border bg-card p-4 space-y-3"
        >
          <DetailRow label="Phone" value={contact.phone} mono />
          {contact.email && <DetailRow label="Email" value={contact.email} />}
          <DetailRow label="City" value={contact.cityName} />
          {contact.interest.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Interests</p>
              <div className="flex flex-wrap gap-1.5">
                {contact.interest.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px]">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {!isBusiness && contact.bhk && (
            <DetailRow label="BHK" value={contact.bhk} />
          )}
          {isBusiness && contact.firmName && (
            <DetailRow label="Firm" value={contact.firmName} />
          )}
          {isBusiness && contact.businessTypeName && (
            <DetailRow label="Business type" value={contact.businessTypeName} />
          )}
          {contact.notes && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Notes</p>
              <p className="text-sm whitespace-pre-line">{contact.notes}</p>
            </div>
          )}
        </section>
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

function RequestsSection({ requests }: { requests: TeamContactRequest[] }) {
  if (requests.length === 0) {
    return (
      <section
        aria-label="Requests"
        className="rounded-2xl border bg-card p-4 space-y-2"
      >
        <h2 className="text-base font-semibold tracking-tight">
          Requests <span className="text-sm font-normal text-muted-foreground">(0)</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          No requests linked to this contact yet.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Requests"
      className="rounded-2xl border bg-card p-4 space-y-4"
    >
      <h2 className="text-base font-semibold tracking-tight">
        Requests{' '}
        <span className="text-sm font-normal text-muted-foreground">
          ({requests.length})
        </span>
      </h2>
      <ul className="space-y-2" aria-label="Request history">
        {requests.map((r) => {
          const variant = STATUS_BADGE_VARIANT[r.statusStageCode] ?? 'outline';
          return (
            <li key={r.id}>
              <Link
                href={`/requests/${r.id}`}
                className={cn(
                  'block rounded-xl border bg-background px-3 py-2.5 shadow-sm',
                  'transition-colors hover:bg-accent/40 active:bg-accent',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium truncate">{r.customerName}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(r.createdAt), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                  <Badge variant={variant} className="text-[10px] shrink-0">
                    {r.statusStageName}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
                  <Badge variant="secondary" className="text-[10px]">
                    {r.cityName}
                  </Badge>
                  <span className="text-muted-foreground">
                    Assigned to{' '}
                    <span className="font-medium text-foreground">
                      {r.assignedExecName ?? 'unassigned'}
                    </span>
                  </span>
                  {r.totalAmountPaise !== null && r.totalAmountPaise > 0 && (
                    <span className="text-muted-foreground font-mono">
                      {rupees(r.totalAmountPaise)}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
