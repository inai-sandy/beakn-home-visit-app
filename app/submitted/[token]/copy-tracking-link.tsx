"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// HVA-35 (Copy) + HVA-145 (Share): URL display + clipboard + native share sheet.
// Lives in its own client island because the parent server component renders
// the URL but clipboard / share APIs need the browser. The plain-text URL
// above the buttons gives mobile users an OS-native long-press copy path
// even when navigator.clipboard or navigator.share aren't available.

const COPIED_RESET_MS = 2000;

interface CopyTrackingLinkProps {
  url: string;
  /** Optional title surfaced by the native share sheet (e.g. on iOS / Android). */
  shareTitle?: string;
  /** Optional body text surfaced by the native share sheet. */
  shareText?: string;
}

export function CopyTrackingLink({
  url,
  shareTitle = "Customer tracking link",
  shareText,
}: CopyTrackingLinkProps) {
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

  // Mirrors components/content/ResourcesView.tsx — try native share, fall
  // back to clipboard if the API isn't available or rejects (e.g. desktop
  // browsers without OS share integration). AbortError = user dismissed
  // the sheet; not an error.
  async function onShare() {
    const shareData = { title: shareTitle, text: shareText, url };
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied — paste into WhatsApp / SMS / email");
    } catch {
      toast.error("Could not share or copy the link");
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="font-mono text-sm break-all text-foreground/90 select-all">
        {url}
      </p>
      <div className="flex gap-2 sm:shrink-0">
        <Button
          type="button"
          variant="outline"
          onClick={onCopy}
          className="h-10 flex-1 sm:flex-initial"
          aria-label="Copy tracking link"
        >
          <Icon
            name={copied ? "check" : "content_copy"}
            size="sm"
            className={copied ? "text-primary" : undefined}
          />
          <span>{copied ? "Copied" : "Copy"}</span>
        </Button>
        <Button
          type="button"
          variant="default"
          onClick={onShare}
          className="h-10 flex-1 sm:flex-initial"
          aria-label="Share tracking link"
        >
          <Icon name="share" size="sm" />
          <span>Share</span>
        </Button>
      </div>
    </div>
  );
}
