"use client";

import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// =============================================================================
// InfoTooltip — small (i) icon next to a label, opens a tooltip on hover/tap
// =============================================================================
//
// Pattern: <InfoTooltip label="Performance">Today's team performance ...</InfoTooltip>
//   → renders the label as text + a small Material Symbols `info` icon
//     wrapped in a Tooltip trigger.
//
// `aria-label` on the icon button announces the tooltip body to screen
// readers (full content, not just "info"). On touch devices radix's
// long-press handler shows the tooltip; tap-elsewhere dismisses.
// =============================================================================

interface InfoTooltipProps {
  /** Visible label rendered before the icon. */
  label?: React.ReactNode;
  /** Tooltip body. Plain text or short JSX. */
  children: React.ReactNode;
  /** Optional className override on the wrapper (positioning helper). */
  className?: string;
  /** When true, only the icon renders (no inline label). */
  iconOnly?: boolean;
}

export function InfoTooltip({
  label,
  children,
  className,
  iconOnly = false,
}: InfoTooltipProps) {
  // The tooltip body becomes the aria-label so screen readers get full
  // content; the icon button itself has no other text.
  const bodyForAria =
    typeof children === "string" ? children : "More information";

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {!iconOnly && label}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={bodyForAria}
            className={cn(
              "inline-flex items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              // 44dp touch target via padding; visual icon stays small.
              "h-6 w-6",
            )}
          >
            <Icon name="info" size="xs" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{children}</TooltipContent>
      </Tooltip>
    </span>
  );
}
