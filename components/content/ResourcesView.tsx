import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import type { ResourcesGroupedByCategory } from '@/lib/content/types';

// =============================================================================
// HVA-156: ResourcesView — read surface shared by both portals
// =============================================================================
//
// Server component. No interactive behaviour — just renders the grouped
// published resources. Used by both the exec /resources and captain
// /captain/resources routes so the two surfaces never drift.
// =============================================================================

interface Props {
  groups: ResourcesGroupedByCategory[];
}

export function ResourcesView({ groups }: Props) {
  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-card/50 p-12 text-center">
        <Icon
          name="menu_book"
          size="lg"
          className="text-muted-foreground/60 mx-auto mb-3"
          aria-hidden
        />
        <h2 className="text-lg font-semibold tracking-tight">
          No resources yet
        </h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          Admin posts sales scripts, pricing sheets, brand assets, and training
          material here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section
          key={group.category}
          aria-label={group.label}
          className="space-y-3"
        >
          <h2 className="text-base font-semibold tracking-tight">
            {group.label}
            <span className="text-sm font-normal text-muted-foreground ml-2">
              ({group.rows.length})
            </span>
          </h2>
          <ul className="space-y-3">
            {group.rows.map((r) => (
              <li
                key={r.id}
                className="rounded-2xl border bg-card p-4 shadow-sm space-y-2"
              >
                <p className="text-base font-semibold tracking-tight">
                  {r.title}
                </p>
                <p className="text-sm whitespace-pre-line text-foreground/90">
                  {r.body}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {r.authorName ?? '—'} · updated{' '}
                  {r.updatedAt.toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
