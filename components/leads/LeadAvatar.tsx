import { cn } from '@/lib/utils';

// =============================================================================
// HVA-73 follow-up: name-keyed avatar circle
// =============================================================================
//
// Deterministic colour from a name hash so the same lead always renders
// with the same swatch across list, detail, and any future surfaces.
//
// Palette: 8 muted brand-adjacent hues. Avoid pure red (status: error)
// and pure black (text). Bg gets a -500 tone, foreground stays white for
// AA contrast on every entry.
// =============================================================================

const PALETTE = [
  'bg-slate-500',
  'bg-emerald-600',
  'bg-teal-600',
  'bg-sky-600',
  'bg-indigo-600',
  'bg-violet-600',
  'bg-amber-600',
  'bg-rose-500',
] as const;

function hashName(name: string): number {
  // Simple djb2 — deterministic, runs identically on server + client so the
  // RSC payload doesn't disagree with hydration.
  let h = 5381;
  for (let i = 0; i < name.length; i += 1) {
    h = (h * 33) ^ name.charCodeAt(i);
  }
  return Math.abs(h);
}

export function leadAvatarColorClass(name: string | null | undefined): string {
  if (!name || name.trim() === '') return 'bg-muted';
  return PALETTE[hashName(name.trim()) % PALETTE.length];
}

export function leadAvatarInitial(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (trimmed === '') return '?';
  // First alphanumeric grapheme; fallback to first char if name starts
  // with punctuation/emoji.
  const m = trimmed.match(/[\p{L}\p{N}]/u);
  return (m?.[0] ?? trimmed[0]).toUpperCase();
}

interface LeadAvatarProps {
  name: string | null | undefined;
  /**
   * "md" → 40dp (list rows, default). "lg" → 64dp (detail header).
   * Sized via Tailwind utility classes so the variant works without a
   * runtime style attribute.
   */
  size?: 'md' | 'lg';
  className?: string;
  'aria-hidden'?: boolean;
}

export function LeadAvatar({
  name,
  size = 'md',
  className,
  'aria-hidden': ariaHidden,
}: LeadAvatarProps) {
  const empty = !name || name.trim() === '';
  return (
    <span
      data-slot="lead-avatar"
      aria-hidden={ariaHidden}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none',
        size === 'lg' ? 'size-16 text-2xl' : 'size-10 text-base',
        empty ? 'bg-muted text-muted-foreground' : leadAvatarColorClass(name),
        className,
      )}
    >
      {leadAvatarInitial(name)}
    </span>
  );
}
