'use client';

import { useState } from 'react';

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
// HVA-248: secrets list + generate-once modal + revoke
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {secrets.length === 0
            ? 'No secrets yet. Generate one to start receiving webhooks.'
            : `${secrets.length} ${secrets.length === 1 ? 'secret' : 'secrets'} on record.`}
        </p>
        <Button
          onClick={() => doGenerate(undefined as unknown as void)}
          disabled={generating}
        >
          <Icon name="key" size="xs" />
          {generating ? 'Generating…' : 'Generate new secret'}
        </Button>
      </div>

      {secrets.length > 0 ? (
        <div className="rounded-2xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Preview</th>
                <th className="px-4 py-2 text-left">Created by</th>
                <th className="px-4 py-2 text-left">Created</th>
                <th className="px-4 py-2 text-left">Last used</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {secrets.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="px-4 py-3 font-mono text-xs">{s.preview}</td>
                  <td className="px-4 py-3">{s.createdByName ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {s.createdAt.toLocaleString('en-IN', {
                      timeZone: 'Asia/Kolkata',
                    })}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {s.lastUsedAt
                      ? s.lastUsedAt.toLocaleString('en-IN', {
                          timeZone: 'Asia/Kolkata',
                        })
                      : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    {s.isActive ? (
                      <span className="text-emerald-600 text-xs font-medium">
                        Active
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        Revoked{' '}
                        {s.revokedAt?.toLocaleDateString('en-IN', {
                          timeZone: 'Asia/Kolkata',
                        })}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {s.isActive ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={revoking}
                        onClick={() => doRevoke({ id: s.id })}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    </div>
  );
}
