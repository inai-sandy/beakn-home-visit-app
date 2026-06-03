import { Icon } from '@/components/ui/icon';

// Tiny notice rendered at the top of every interactive captain-portal
// page so admin knows action buttons (if visible) will not write.
// Ship 2 wires the simple list pages; Ship 2.5 will replace this
// banner with per-button disabled treatment.
export function ViewOnlyNotice({ message }: { message?: string }) {
  return (
    <div className="rounded-xl border border-amber-400/40 bg-amber-50/60 dark:bg-amber-900/20 px-3 py-2 flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200">
      <Icon name="lock" size="xs" />
      <p>
        {message ??
          'Read-only mirror of the captain view. Editing is disabled for the admin viewer.'}
      </p>
    </div>
  );
}
