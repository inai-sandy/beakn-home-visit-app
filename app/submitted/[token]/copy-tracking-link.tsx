"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// =============================================================================
// HVA-35: CopyTrackingLink — URL display + clipboard button
// =============================================================================
//
// Lives in its own client island because the parent /submitted/[token]
// page is a server component and clipboard access needs the browser. The
// URL itself is rendered server-side (here as a prop); only the Copy
// button needs interactivity.
//
// UX details:
//   - On copy success: Sonner toast + button momentarily flips to
//     "✓ Copied" for 2 seconds, then reverts. Two channels of feedback
//     so the user gets it regardless of whether they're watching the
//     button or the toast.
//   - On copy failure (rare — typically permissions or insecure
//     context): Sonner error toast pointing to long-press fallback.
//     The URL above the button is rendered as plain text so long-press
//     on mobile picks up the OS-native copy menu.
// =============================================================================

const COPIED_RESET_MS = 2000;

interface CopyTrackingLinkProps {
  url: string;
}

export function CopyTrackingLink({ url }: CopyTrackingLinkProps) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Tracking link copied");
      window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      toast.error("Couldn't copy", {
        description: "Long-press the URL above to copy manually.",
      });
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="font-mono text-sm break-all text-foreground/90 select-all">
        {url}
      </p>
      <Button
        type="button"
        variant="outline"
        onClick={onCopy}
        className="h-10 sm:shrink-0"
        aria-label="Copy tracking link"
      >
        <Icon
          name={copied ? "check" : "content_copy"}
          size="sm"
          className={copied ? "text-primary" : undefined}
        />
        <span>{copied ? "Copied" : "Copy"}</span>
      </Button>
    </div>
  );
}
