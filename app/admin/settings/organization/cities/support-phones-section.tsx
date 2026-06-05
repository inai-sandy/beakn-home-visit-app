"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// =============================================================================
// HVA-90: SupportPhonesSection — inline top-of-page editor for the two
// support-phone config values (customer + admin).
// =============================================================================
//
// Sandeep 2026-06-05: *"Top-level config section (above the list)...
// Customer Support Phone (used on tracking-page footer), Admin Support
// Phone (used on Forgot Password modal). Both stored in app_config."*
//
// Wraps the existing /api/admin/config/customer-support-phone and the
// new /api/admin/config/admin-support-phone routes. Each input has its
// own dirty-state + Save button so admins can update one without
// disturbing the other. No modal — inline edit matches the existing
// dedicated config pages.
// =============================================================================

interface Props {
  customerSupportPhone: string;
  adminSupportPhone: string;
}

export function SupportPhonesSection({
  customerSupportPhone,
  adminSupportPhone,
}: Props) {
  return (
    <section
      aria-label="Support phones"
      className="rounded-3xl border bg-card p-5 shadow-sm space-y-4"
    >
      <header className="space-y-1">
        <h2 className="text-base font-semibold tracking-tight inline-flex items-center gap-2">
          <Icon name="support_agent" size="sm" className="text-muted-foreground" />
          Support phones
        </h2>
        <p className="text-[12px] text-muted-foreground">
          Phone numbers surfaced to customers (tracking-page footer) and to
          execs / captains who&apos;ve locked themselves out (forgot-password modal).
        </p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PhoneField
          label="Customer Support Phone"
          subline="Shown on the /track page footer."
          initialValue={customerSupportPhone}
          endpoint="/api/admin/config/customer-support-phone"
        />
        <PhoneField
          label="Admin Support Phone"
          subline="Shown on the Forgot Password modal."
          initialValue={adminSupportPhone}
          endpoint="/api/admin/config/admin-support-phone"
        />
      </div>
    </section>
  );
}

function PhoneField({
  label,
  subline,
  initialValue,
  endpoint,
}: {
  label: string;
  subline: string;
  initialValue: string;
  endpoint: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dirty = value.trim() !== initialValue.trim();
  const inputId = `phone-${endpoint.replace(/[^a-z]/gi, "-")}`;

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(endpoint, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: value.trim() }),
        });
        const j = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          changed?: boolean;
          error?: string;
          fieldErrors?: Record<string, string>;
        };
        if (!res.ok || !j.ok) {
          const msg =
            j.fieldErrors?.value ?? j.error ?? `Request failed (${res.status})`;
          setError(msg);
          toast.error(msg);
          return;
        }
        toast.success(
          j.changed === false ? "No change." : `${label} updated.`,
        );
        router.refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        setError(msg);
        toast.error(msg);
      }
    });
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId} className="text-xs">
        {label}
      </Label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          type="tel"
          inputMode="tel"
          placeholder="+919876543210"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-10 flex-1"
          disabled={pending}
          aria-invalid={error !== null}
        />
        <Button
          onClick={save}
          disabled={!dirty || pending}
          size="sm"
          className="h-10"
        >
          {pending ? (
            <Icon name="progress_activity" size="xs" className="animate-spin" />
          ) : (
            "Save"
          )}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">{subline}</p>
      {error && (
        <p
          role="alert"
          className="text-[11px] text-destructive leading-tight"
        >
          {error}
        </p>
      )}
    </div>
  );
}
