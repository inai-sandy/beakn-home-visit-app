import type { Role } from '@/lib/auth/roles';

// =============================================================================
// HVA-73 PR 2 + PR 3: client-safe types for the NotesSection
// =============================================================================
//
// Kept in a separate module from lib/notes/queries.ts because the client
// component imports `roleLabel` + `NoteRow`. If those lived in queries.ts,
// the client bundle would drag db/client.ts (postgres-js) into the
// browser. Module-level type imports + this tiny helper are safe to
// ship to either runtime.
// =============================================================================

export type NoteTarget = 'request' | 'contact';

export interface NoteRow {
  id: string;
  body: string;
  createdAt: Date;
  authorUserId: string;
  authorName: string | null;
  authorRole: Role;
}

export function roleLabel(role: Role): string {
  switch (role) {
    case 'sales_executive':
      return 'Sales Exec';
    case 'captain':
      return 'Captain';
    case 'super_admin':
      return 'Admin';
    // HVA-237: support team — kept short like "Sales Exec" since it'll
    // appear inline in note rows and comment threads (HVA-231 Phase 3).
    case 'support':
      return 'Support';
    default:
      return role;
  }
}
