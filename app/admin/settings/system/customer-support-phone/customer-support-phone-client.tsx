"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// =============================================================================
// HVA-105 (extended): CustomerSupportPhoneClient
// =============================================================================
//
// Mirrors HVA-110's single-edit-dialog pattern but in a single-row context
// (there's only one config key here, not a list). Shows current stored
// value verbatim — no prettification, admin sees what's stored. Editing
// opens a Dialog with a single field + Save.
// =============================================================================

export function CustomerSupportPhoneClient({
  currentValue,
}: {
  currentValue: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const isUnset = currentValue.trim() === "";

  return (
    <>
      <div className="rounded-3xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold tracking-tight">
                Stored value
              </h3>
              {isUnset && (
                <Badge variant="outline" className="text-[10px]">
                  Unset
                </Badge>
              )}
            </div>
            <p className="text-sm">
              {isUnset ? (
                <span className="text-amber-700 italic">
                  not set — /track footer shows a placeholder with a &ldquo;Demo
                  number&rdquo; notice
                </span>
              ) : (
                <span className="font-mono">{currentValue}</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              Required format: <span className="font-mono">+91XXXXXXXXXX</span>{" "}
              (no spaces). Leave blank to reset.
            </p>
          </div>
          <div className="shrink-0">
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              Edit
            </Button>
          </div>
        </div>
      </div>

      {open && (
        <EditDialog
          currentValue={currentValue}
          onClose={() => setOpen(false)}
          onSuccess={() => {
            router.refresh();
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function EditDialog({
  currentValue,
  onClose,
  onSuccess,
}: {
  currentValue: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [value, setValue] = useState(currentValue);
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  async function onSubmit() {
    setSubmitting(true);
    setFieldError(null);
    setGeneralError(null);
    try {
      const res = await fetch("/api/admin/config/customer-support-phone", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: value.trim() }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: Record<string, string>;
        changed?: boolean;
      };
      if (!res.ok || !j.ok) {
        setFieldError(j.fieldErrors?.value ?? null);
        setGeneralError(j.error ?? `Request failed (${res.status})`);
        toast.error(j.error ?? "Update failed.");
        return;
      }
      toast.success(
        j.changed === false
          ? "No changes — value unchanged."
          : value.trim() === ""
            ? "Cleared — /track footer reverts to placeholder."
            : "Customer support phone updated.",
      );
      onSuccess();
    } catch (err) {
      setGeneralError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Edit customer support phone</DialogTitle>
          <DialogDescription>
            Required: <span className="font-mono">+91XXXXXXXXXX</span> (exactly
            13 characters, no spaces). Leave blank to reset to the demo
            placeholder.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label htmlFor="support-phone">Phone number</Label>
          <Input
            id="support-phone"
            type="tel"
            placeholder="+919876543210"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={submitting}
            className="h-12 font-mono"
            autoFocus
          />
          {fieldError && (
            <p className="text-xs text-destructive">{fieldError}</p>
          )}
          {generalError && (
            <div
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive border border-destructive/30"
            >
              {generalError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Icon name="progress_activity" size="sm" className="animate-spin" />
                <span>Saving…</span>
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
