'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';
import type { CartplusSecretListRow } from '@/lib/admin/cartplus';

import {
  generateCartplusSecretAction,
  revokeCartplusSecretAction,
} from './actions';

// =============================================================================
// HVA-248 / HVA-248-FIX2: secrets list + generate-once modal + revoke
// =============================================================================
//
// FIX2: rebuilt with the same card-list visual idiom as the other admin
// pages (rounded-3xl border bg-card p-5 shadow-sm).
// =============================================================================

interface Props {
  secrets: CartplusSecretListRow[];
}

export function SecretsClient({ secrets }: Props) {
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { mutate: doGenerate, isPending: generating } = useServerMutation(
    async () => generateCartplusSecretAction(),
    {
      successMessage: 'Secret generated',
      onSuccess: (data) => {
        if (data) setNewSecret(data.secret);
      },
    },
  );

  const { mutate: doRevoke, isPending: revoking } = useServerMutation(
    revokeCartplusSecretAction,
    { successMessage: 'Secret revoked' },
  );

  function copyToClipboard() {
    if (!newSecret) return;
    void navigator.clipboard.writeText(newSecret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function fmt(d: Date | null): string {
    if (!d) return 'Never';
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  }

  return (
    <>
      <section className="flex items-baseline justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {secrets.length === 0
            ? 'No secrets yet — generate one to start receiving webhooks.'
            : `${secrets.length} ${secrets.length === 1 ? 'secret' : 'secrets'} on record`}
        </p>
        <Button
          onClick={() => doGenerate(undefined as unknown as void)}
          disabled={generating}
        >
          <Icon name="key" size="xs" />
          {generating ? 'Generating…' : 'Generate new secret'}
        </Button>
      </section>

      {secrets.length > 0 ? (
        <ul className="space-y-3">
          {secrets.map((s) => (
            <li
              key={s.id}
              className="rounded-3xl border bg-card p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-base font-mono font-semibold tracking-tight">
                      {s.preview}
                    </code>
                    {s.isActive ? (
                      <Badge
                        variant="outline"
                        className="text-xs bg-emerald-500/10 text-emerald-700 border-emerald-500/30"
                      >
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        Revoked
                      </Badge>
                    )}
                  </div>
                  <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                    <div>
                      <span className="font-medium text-foreground/70">
                        Created by
                      </span>{' '}
                      {s.createdByName ?? '—'}
                    </div>
                    <div>
                      <span className="font-medium text-foreground/70">
                        Created
                      </span>{' '}
                      {fmt(s.createdAt)}
                    </div>
                    <div>
                      <span className="font-medium text-foreground/70">
                        Last used
                      </span>{' '}
                      {fmt(s.lastUsedAt)}
                    </div>
                    {!s.isActive && s.revokedAt ? (
                      <div className="sm:col-span-3">
                        <span className="font-medium text-foreground/70">
                          Revoked
                        </span>{' '}
                        {fmt(s.revokedAt)}
                      </div>
                    ) : null}
                  </div>
                </div>
                {s.isActive ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revoking}
                    onClick={() => doRevoke({ id: s.id })}
                  >
                    Revoke
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog
        open={newSecret !== null}
        onOpenChange={(open) => {
          if (!open) setNewSecret(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your new signing secret</DialogTitle>
            <DialogDescription>
              This is the only time the full secret will be shown. Paste it
              into the CartPlus webhook configuration <em>now</em>. If you
              lose it, generate a new one.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted px-3 py-2 font-mono text-sm break-all">
            {newSecret}
          </div>
          <DialogFooter className="flex-row justify-end gap-2">
            <Button variant="outline" onClick={copyToClipboard}>
              <Icon name={copied ? 'check' : 'content_copy'} size="xs" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button onClick={() => setNewSecret(null)}>I've saved it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
