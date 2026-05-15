"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// HVA-104: small client island for clipboard.writeText. Identical UX
// pattern to HVA-35's CopyTrackingLink — 2-second confirmation state +
// Sonner toast, with a long-press fallback message if clipboard is
// blocked (insecure context, permissions, etc.).

const COPIED_RESET_MS = 2000;

export function CopyAddressButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success("Address copied");
      window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      toast.error("Couldn't copy", {
        description: "Long-press the address to copy manually.",
      });
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onCopy}
      aria-label="Copy address"
    >
      <Icon
        name={copied ? "check" : "content_copy"}
        size="xs"
        className={copied ? "text-primary" : undefined}
      />
      <span>{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}
