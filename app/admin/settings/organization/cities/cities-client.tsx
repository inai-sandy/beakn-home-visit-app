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
// HVA-110 + HVA-90: CitiesClient — list rows + multi-field edit modal
// =============================================================================
//
// HVA-110 shipped with a single-field "edit routing email" modal. HVA-90
// extends to a multi-field "edit city" modal covering:
//
//   - captain_routing_email (HVA-110 — every row except Other)
//   - discord_webhook_url   (HVA-90 — every row; live ping on save)
//   - other_routing_email   (HVA-90 — only the Other row)
//
// The "Other" row's Edit button is now ENABLED (HVA-90) so admin can
// set the catch-all routing email, but the modal hides
// `captain_routing_email` for that row and shows `other_routing_email`
// instead. Same multi-field PATCH endpoint either way.
// =============================================================================

interface CityRow {
  id: string;
  name: string;
  state: string | null;
  captainUserId: string | null;
  captainName: string | null;
  captainIsActive: boolean | null;
  captainRoutingEmail: string | null;
  otherRoutingEmail: string | null;
  discordWebhookUrl: string | null;
  isActive: boolean;
}

interface Props {
  cities: CityRow[];
}

function truncate(value: string, n: number): string {
  if (value.length <= n) return value;
  return `${value.slice(0, n - 1)}…`;
}

export function CitiesClient({ cities }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<CityRow | null>(null);

  return (
    <>
      <ul className="space-y-3">
        {cities.map((c) => {
          const isOther = c.name === "Other";
          return (
            <li
              key={c.id}
              className="rounded-3xl border bg-card p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-semibold tracking-tight">
                      {c.name}
                    </h3>
                    {c.state && (
                      <Badge variant="outline" className="text-[10px]">
                        {c.state}
                      </Badge>
                    )}
                    {isOther && (
                      <Badge variant="outline" className="text-[10px]">
                        Catch-all
                      </Badge>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    <span className="text-muted-foreground/70">Captain: </span>
                    {c.captainName ? (
                      <>
                        <span className="font-medium text-foreground">
                          {c.captainName}
                        </span>
                        {c.captainIsActive === false && (
                          <span className="ml-1 text-amber-700">(inactive)</span>
                        )}
                      </>
                    ) : (
                      <span>—</span>
                    )}
                  </p>

                  {isOther ? (
                    <p className="text-xs">
                      <span className="text-muted-foreground/70">
                        Other-row routing email:{" "}
                      </span>
                      {c.otherRoutingEmail ? (
                        <span className="font-mono">{c.otherRoutingEmail}</span>
                      ) : (
                        <span className="text-amber-700 italic">
                          not set — Other-city submissions fall back to
                          super_admins
                        </span>
                      )}
                    </p>
                  ) : (
                    <p className="text-xs">
                      <span className="text-muted-foreground/70">
                        Routing email:{" "}
                      </span>
                      {c.captainRoutingEmail ? (
                        <span className="font-mono">{c.captainRoutingEmail}</span>
                      ) : (
                        <span className="text-amber-700 italic">
                          not set — submissions route to super_admins as [UNROUTED]
                        </span>
                      )}
                    </p>
                  )}

                  <p className="text-xs">
                    <span className="text-muted-foreground/70">
                      Discord webhook:{" "}
                    </span>
                    {c.discordWebhookUrl ? (
                      <span
                        className="font-mono"
                        title={c.discordWebhookUrl}
                      >
                        {truncate(c.discordWebhookUrl, 60)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic">
                        not set — no Discord notification for this city
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(c)}
                  >
                    Edit
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {editing && (
        <EditCityModal
          city={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            router.refresh();
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function EditCityModal({
  city,
  onClose,
  onSuccess,
}: {
  city: CityRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const isOther = city.name === "Other";
  const [captainEmail, setCaptainEmail] = useState(
    city.captainRoutingEmail ?? "",
  );
  const [otherEmail, setOtherEmail] = useState(city.otherRoutingEmail ?? "");
  const [discordUrl, setDiscordUrl] = useState(city.discordWebhookUrl ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  async function onSubmit() {
    setSubmitting(true);
    setFieldErrors({});
    setGeneralError(null);

    const body: Record<string, string | null> = {};
    if (!isOther) {
      const trimmed = captainEmail.trim();
      body.captainRoutingEmail = trimmed === "" ? null : trimmed;
    }
    if (isOther) {
      const trimmed = otherEmail.trim();
      body.otherRoutingEmail = trimmed === "" ? null : trimmed;
    }
    const dUrl = discordUrl.trim();
    body.discordWebhookUrl = dUrl === "" ? null : dUrl;

    try {
      const res = await fetch(`/api/admin/cities/${city.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: Record<string, string>;
        changed?: boolean;
      };
      if (!res.ok || !j.ok) {
        setFieldErrors(j.fieldErrors ?? {});
        setGeneralError(j.error ?? `Request failed (${res.status})`);
        toast.error(j.error ?? "Update failed.");
        return;
      }
      toast.success(
        j.changed === false
          ? "No changes."
          : `${city.name} updated.`,
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
      <DialogContent className="sm:max-w-lg rounded-3xl">
        <DialogHeader>
          <DialogTitle>Edit {city.name}</DialogTitle>
          <DialogDescription>
            {isOther
              ? "Other-row config — set the catch-all routing email and the Discord webhook for unrecognised cities."
              : "Configure the captain routing email and Discord webhook for this city. The webhook URL is live-tested on save."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isOther && (
            <div className="space-y-1">
              <Label htmlFor="city-captain-email">Captain routing email</Label>
              <Input
                id="city-captain-email"
                type="email"
                placeholder="captain@example.com"
                value={captainEmail}
                onChange={(e) => setCaptainEmail(e.target.value)}
                disabled={submitting}
                className="h-11"
                autoFocus
              />
              <p className="text-[10px] text-muted-foreground">
                Customer requests for {city.name} are emailed to this address.
                Leave blank to fall back to the super_admin [UNROUTED] inbox.
              </p>
              {fieldErrors.captainRoutingEmail && (
                <p className="text-xs text-destructive">
                  {fieldErrors.captainRoutingEmail}
                </p>
              )}
            </div>
          )}

          {isOther && (
            <div className="space-y-1">
              <Label htmlFor="city-other-email">Other-row routing email</Label>
              <Input
                id="city-other-email"
                type="email"
                placeholder="ops@example.com"
                value={otherEmail}
                onChange={(e) => setOtherEmail(e.target.value)}
                disabled={submitting}
                className="h-11"
                autoFocus
              />
              <p className="text-[10px] text-muted-foreground">
                Customer requests for unrecognised cities go here. Leave
                blank to keep falling back to all super_admins.
              </p>
              {fieldErrors.otherRoutingEmail && (
                <p className="text-xs text-destructive">
                  {fieldErrors.otherRoutingEmail}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="city-discord-webhook">Discord webhook URL</Label>
            <Input
              id="city-discord-webhook"
              type="url"
              placeholder="https://discord.com/api/webhooks/..."
              value={discordUrl}
              onChange={(e) => setDiscordUrl(e.target.value)}
              disabled={submitting}
              className="h-11 font-mono text-[12px]"
            />
            <p className="text-[10px] text-muted-foreground">
              We POST a one-line test message to verify the webhook before
              saving. Channel members will see &ldquo;Webhook validated by
              Beakn admin&rdquo; once on save.
            </p>
            {fieldErrors.discordWebhookUrl && (
              <p className="text-xs text-destructive">
                {fieldErrors.discordWebhookUrl}
              </p>
            )}
          </div>

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
                <Icon
                  name="progress_activity"
                  size="sm"
                  className="animate-spin"
                />
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
