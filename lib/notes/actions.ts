'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { leads, notes, users, visitRequests } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { isRole, type Role } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';

import { canWriteNoteForEntity } from './queries';
import type { NoteRow, NoteTarget } from './types';

// =============================================================================
// HVA-73 PR 2 + PR 3: addNoteAction — append a note to a request or contact
// =============================================================================
//
// Trim body, refuse empty / >2000 chars. Centralised auth via
// canWriteNoteForEntity. INSERT, audit, revalidate. Returns the inserted
// row (with author info joined) so the caller can reconcile its
// optimistic insert.
//
// Append-only by design (D1): there is no editNoteAction or
// deleteNoteAction. Past notes are historical record.
// =============================================================================

const MAX_BODY_LENGTH = 2000;

export interface AddNoteInput {
  targetType: NoteTarget;
  targetId: string;
  body: string;
}

export type AddNoteResult =
  | { ok: true; note: NoteRow }
  | { ok: false; error: string };

export async function addNoteAction(
  input: AddNoteInput,
): Promise<AddNoteResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const actor = session.user as {
    id: string;
    role?: string;
    fullName?: string;
  };
  if (!isRole(actor.role)) return { ok: false, error: 'Forbidden' };

  const body = input.body.trim();
  if (body.length === 0) {
    return { ok: false, error: 'Note cannot be empty' };
  }
  if (body.length > MAX_BODY_LENGTH) {
    return {
      ok: false,
      error: `Note must be at most ${MAX_BODY_LENGTH} characters`,
    };
  }

  if (input.targetType !== 'request' && input.targetType !== 'contact') {
    return { ok: false, error: 'Invalid target type' };
  }

  // Verify the target entity exists before doing any auth lookup. Cheap
  // FK substitute since the notes table is polymorphic.
  if (input.targetType === 'request') {
    const [row] = await db
      .select({ id: visitRequests.id })
      .from(visitRequests)
      .where(eq(visitRequests.id, input.targetId))
      .limit(1);
    if (!row) return { ok: false, error: 'Request not found' };
  } else {
    const [row] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(eq(leads.id, input.targetId))
      .limit(1);
    if (!row) return { ok: false, error: 'Contact not found' };
  }

  const allowed = await canWriteNoteForEntity(
    { id: actor.id, role: actor.role as Role },
    input.targetType,
    input.targetId,
  );
  if (!allowed) {
    return { ok: false, error: 'Not allowed to write a note here' };
  }

  const [inserted] = await db
    .insert(notes)
    .values({
      targetType: input.targetType,
      targetId: input.targetId,
      body,
      createdByUserId: actor.id,
    })
    .returning({
      id: notes.id,
      body: notes.body,
      createdAt: notes.createdAt,
      createdByUserId: notes.createdByUserId,
    });

  // Re-fetch the author's name + role from users so the returned shape
  // matches what loadNotesForEntity hands back. Tiny cost; keeps the
  // caller's reconciliation logic uniform.
  const [author] = await db
    .select({ fullName: users.fullName, role: users.role })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  await logEvent({
    eventType: 'note_created',
    actorUserId: actor.id,
    actorRole: actor.role as Role,
    targetEntityType: input.targetType === 'request' ? 'visit_request' : 'lead',
    targetEntityId: input.targetId,
    afterState: {
      noteId: inserted.id,
      targetType: input.targetType,
      bodyLength: body.length,
      // Short preview to make audit logs greppable without storing the
      // entire body twice. Truncated so very long notes don't bloat the
      // audit row.
      bodyPreview: body.length > 120 ? `${body.slice(0, 117)}…` : body,
    },
  });

  // Invalidate every surface that renders this entity's notes.
  if (input.targetType === 'request') {
    revalidatePath(`/requests/${input.targetId}`);
  } else {
    revalidatePath(`/leads/${input.targetId}`);
    revalidatePath(`/captain/contacts/${input.targetId}`);
  }
  revalidatePath('/', 'layout');

  return {
    ok: true,
    note: {
      id: inserted.id,
      body: inserted.body,
      createdAt: inserted.createdAt,
      authorUserId: inserted.createdByUserId,
      authorName: author?.fullName ?? null,
      authorRole: (author?.role ?? actor.role) as Role,
    },
  };
}
