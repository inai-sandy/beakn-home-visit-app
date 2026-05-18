# Production Secrets Management (HVA-97)

How secrets live, where they hide, and what to do when one needs to change or
gets lost.

This document is the operator's manual. The runtime contract — which env vars
the app reads and what they do — lives in [`.env.example`](../.env.example).
This document covers everything around them: storage, rotation, recovery.

## 1. Where secrets live

| Environment | Path | Permissions | Backed up where |
|---|---|---|---|
| Local dev | `<repo>/.env.local` | user-readable, gitignored via `.gitignore` rule `.env*` with `!.env.example` negation | not backed up — regenerate from `.env.example` per dev machine |
| Production VPS | `/opt/beakn-secrets/.env.production` | **`chmod 600`**, owned by `beakn:beakn` | 1Password vault item "Beakn Production Secrets" |
| Encrypted backup | 1Password vault → "Beakn Production Secrets" item, attached file | only Sandeep + named operators have access | this is the authoritative copy of last resort |

The prod VPS path is **outside the repo checkout** by design. If the repo
directory gets clobbered (force-reset, rm, accidental rsync), the secrets
file stays untouched. The Docker `--env-file` flag in `scripts/deploy.sh`
points at `/opt/beakn-secrets/.env.production`; the in-repo `.env.local` is
only consulted in dev.

Recovery flow when the prod file is missing → §6 Disaster Recovery.

## 2. Secret inventory

Every key that contains a sensitive value. Non-sensitive config (URLs, SMTP
host, port, sender display name) lives in `.env.example` but isn't tracked
here because nothing rotates and nothing leaks.

| Key | Purpose | How to obtain | Rotation frequency |
|---|---|---|---|
| `DATABASE_URL` | Postgres connection (`beakn_app` role password) | `ALTER USER beakn_app WITH PASSWORD '…'` inside the `beakn-postgres` container; update the value in the URL | Annually, or immediately on any suspected compromise |
| `BETTER_AUTH_SECRET` | HMAC key for session tokens + Better-Auth cookie signing | `openssl rand -hex 32` | Annually. **Rotation invalidates every active session** — every signed-in user gets bounced to `/login`. Coordinate timing. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push (HVA-54). Public key is shipped to browsers; private key signs payloads. | `npx web-push generate-vapid-keys` | **Never** unless leaked. Every existing browser subscription is bound to the public key — rotating forces every device to re-subscribe via the in-app prompt. |
| `INTERAKT_API_KEY_PROD` | Interakt WhatsApp API (live business number) | Interakt dashboard → Developer Settings → API Keys | When Interakt rotates the key, or on suspected compromise |
| `INTERAKT_API_KEY_SANDBOX` | Same as above for the sandbox/test number | Same dashboard | Same — usually concurrent with PROD rotation |
| `SMTP_USER` / `SMTP_PASS` | Hostinger SMTP credentials for `visits@beakn.in` | Hostinger control panel → Emails → `visits@beakn.in` → "Change password" or "App password" | Annually |
| `TURNSTILE_SITE_KEY` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile keys for `/request` anti-spam | Cloudflare dashboard → Turnstile → site widget config | Annually. Site key is technically not secret (it's in the client bundle) but rotate the secret pair together. |
| `DISCORD_WEBHOOK_OTHER_ORDERS` | Discord webhook URL (currently unused — see [`.env.example`](../.env.example)) | Discord server → channel settings → Integrations → Webhooks → New Webhook | When the webhook is leaked (revoke + reissue in Discord) |

Rotation cadence reminders are not yet automated. When the audit-trail ticket
ships (§7), config-change audit entries become the system-of-record.

## 3. Add a new secret

Pre-flight: have you confirmed the value is actually a secret? URL hosts,
non-sensitive flags, public site keys, and port numbers don't belong in this
flow — add them as plain entries in `.env.example` and skip the 1Password
step.

1. **Add a placeholder key to `.env.example`** with a `CHANGE_ME` value and a
   comment block describing purpose, source, and rotation cadence. Commit on
   a feature branch.
2. **Add the real value** to local dev `.env.local` AND to
   `/opt/beakn-secrets/.env.production` on the VPS. Verify file permissions
   are still `600`:
   ```sh
   ssh beakn@<vps>
   sudo chmod 600 /opt/beakn-secrets/.env.production
   ls -la /opt/beakn-secrets/.env.production   # confirm -rw-------
   ```
3. **Update the 1Password backup**: open the "Beakn Production Secrets" item,
   replace the attached file with the new
   `/opt/beakn-secrets/.env.production`. Update the item's "last rotated"
   note.
4. **Restart the prod stack** so the new env var is loaded by the running
   container:
   ```sh
   bash scripts/deploy.sh
   ```
   `scripts/deploy.sh` rebuilds + restarts the container with the updated
   `--env-file`; a simple `docker restart` won't pick up new keys.
5. **Verify the new value reaches the runtime** — typically by hitting a
   route that exercises it (or check `docker logs beakn-app` for the
   feature's startup log line). Don't leave a "I'm sure it took" feeling
   unverified.

## 4. Rotate a secret

Generic template (every rotation follows this shape):

1. **Generate the new value** using the recipe from §2's "How to obtain" column.
2. **Update `/opt/beakn-secrets/.env.production`** on the VPS with the new value.
3. **Update the 1Password backup** — replace the attached file, bump the
   "last rotated" note with today's date.
4. **Restart the prod stack** (`bash scripts/deploy.sh`).
5. **Verify the app still works** — at minimum:
   - `curl -sI https://visits.beakn.in/api/health` returns 200
   - log in once as super_admin and click through a representative page
6. **Revoke the old value at the source** (Cloudflare dashboard, Hostinger
   panel, Interakt dashboard, etc.). Skipping this step leaves a live valid
   credential floating around — defeats the rotation.

Specific recipes follow.

### `BETTER_AUTH_SECRET`

```sh
# 1. generate
openssl rand -hex 32                                 # → copy output

# 2-4. (template)
# 5. verify: log in once, confirm no errors in /api/health
# 6. nothing to revoke at a third party — the old value is now uninstalled
```

⚠️ **All active sessions are invalidated.** Every signed-in user gets a 401
on their next request and bounces to `/login`. Coordinate with users —
preferably rotate during off-hours and post a heads-up. If you rotate in the
middle of a busy day you will get pinged.

### VAPID keys

```sh
# 1. generate
npx web-push generate-vapid-keys                     # → outputs PUBLIC + PRIVATE

# 2-5. (template)
# 6. nothing to revoke at a third party
```

⚠️ **Every browser subscription is now invalid.** Push notifications stop
working for every existing device until each user re-subscribes via the
in-app prompt. Only rotate VAPID keys on a confirmed leak — there's no
"better safe than sorry" version of this rotation.

### SMTP password

```sh
# 1. open Hostinger control panel → Emails → visits@beakn.in →
#    "Change password" (or "Generate app password" for SMTP-specific creds)
# 2-5. (template)
# 6. nothing extra to revoke — Hostinger's password change deactivates the old
```

After rotation, send a test email through the app (e.g., trigger a request
reassignment) and confirm delivery from a non-Beakn inbox.

### Interakt keys

```sh
# 1. Interakt dashboard → Developer Settings → API Keys → "Regenerate"
# 2-5. (template)
# 6. revoke = automatic on regeneration (Interakt invalidates the old key)
```

If only the sandbox key needs rotation, leave the prod key untouched — the
two are independent.

### Turnstile

```sh
# 1. Cloudflare dashboard → Turnstile → site widget → "Rotate keys"
# 2-5. (template, but remember to update BOTH TURNSTILE_SITE_KEY and
#       NEXT_PUBLIC_TURNSTILE_SITE_KEY to the same new value)
# 6. revoke = automatic on rotation
```

After deploy, verify the client bundle picks up the new site key:
```sh
curl -s https://visits.beakn.in/_next/static/chunks/*.js | grep -o '0x[A-Za-z0-9]\{20\}' | head -3
```
The new site key should appear; the old one should not.

## 5. What never goes in the repo

- **Real `.env.local` or `.env.production`.** The `.gitignore` `.env*` rule
  catches these by default; the `!.env.example` negation is the only
  whitelist. Never `git add -f` an env file.
- **Plaintext secrets in code.** Constants, comments, test fixtures, log
  lines, error messages, JSDoc examples — none of these are exempt.
  Test fixtures use `CHANGE_ME`-style placeholders; the test harness mocks
  external services rather than calling them.
- **Secrets in commits, PR descriptions, or Linear tickets.** GitHub PR
  history is forever; Linear comments are forever. Once committed to either,
  the secret is effectively published — rotate immediately, even if the
  commit was reverted or the comment deleted.
- **Secrets in admin UI display.** Any future admin screen that surfaces a
  secret-bearing config value masks it (`••••••`) and offers a "rotate"
  button rather than a "show" button. The audit-trail requirement in §7
  governs the action; the masking rule governs the display.

If you discover a leaked secret — committed, posted, screenshotted, anything
— treat it as a P1: rotate immediately following §4, then file an incident
note in Linear (HVA-?? incident-log issue, create if it doesn't exist). Do
not wait for "convenient timing" to rotate; the window between leak
discovery and rotation is when damage happens.

## 6. Disaster recovery

### Scenario A: `/opt/beakn-secrets/.env.production` is lost or corrupted, 1Password intact

1. Open 1Password → "Beakn Production Secrets" item → download the attached
   file.
2. Place it at `/opt/beakn-secrets/.env.production` on the VPS.
3. `sudo chmod 600 /opt/beakn-secrets/.env.production`; verify
   `ls -la` shows `-rw-------` and ownership `beakn:beakn`.
4. `bash scripts/deploy.sh` to restart with the restored values.
5. Verify `curl -sI https://visits.beakn.in/api/health` returns 200.

### Scenario B: both the VPS file AND 1Password backup are lost

Regenerate every secret from scratch following §4's per-key rotation
recipes. Order matters slightly:

1. `DATABASE_URL` password first — without DB access nothing else matters.
   Reset via:
   ```sh
   docker exec -it beakn-postgres psql -U postgres -c \
     "ALTER USER beakn_app WITH PASSWORD '<new>';"
   ```
   Update `/opt/beakn-secrets/.env.production` with the new URL.
2. `BETTER_AUTH_SECRET`, `VAPID_*`, `INTERAKT_*`, `SMTP_PASS`, `TURNSTILE_*`
   in any order — they're independent.
3. Once `/opt/beakn-secrets/.env.production` is rebuilt, capture it into a
   new 1Password vault item before doing anything else. The DR loop is only
   complete when the backup exists.
4. `bash scripts/deploy.sh`. Verify everything works.

Scenario B is the only path where it's acceptable to announce a forced
re-login to users — and the only path that justifies VAPID key rotation by
necessity rather than leak.

### Scenario C: VPS itself is destroyed

This is outside HVA-97's scope. The runbook for full-VPS rebuild lives in
the deploy ticket (`docs/deploy.md` once it exists) and depends on Postgres
backup state (HVA-?? backup-restore validation).

## 7. Audit trail (requirement, not implementation)

The future admin UI for editing secret-bearing config MUST:

- **Mask all secret values on display** — render as `••••••` (six bullets,
  not the actual length).
- **Never round-trip a secret** through a form input that the user can read
  back. Edit flows accept new values and write them; they don't display the
  current value as the form's default.
- **Write an audit_log row** for every action that touches a secret-bearing
  config key. The row records: actor user id, actor role, target key,
  timestamp, action verb (`rotated`, `cleared`, `replaced`) — **never the
  value**, before or after.
- **Surface a "last rotated" timestamp** per secret in the admin UI so
  operators can see at a glance which secrets are overdue against the
  cadence in §2.

Implementation is **out of scope for HVA-97**. This section locks the
requirement so the implementing ticket (TBD when admin-side secret
management gets prioritized) inherits a fixed contract instead of inventing
one.
