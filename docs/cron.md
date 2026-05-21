# Cron jobs

The Beakn app deploys as a single Docker container behind Caddy. There is no
external scheduler (no Vercel Cron, no AWS EventBridge, no pg_cron). Scheduled
work runs from the **host crontab** on the VPS, calling bearer-protected
`/api/cron/*` endpoints over HTTPS.

This file documents which lines must be installed on the VPS and how to
re-install them after a host rebuild.

---

## Jobs

| Schedule (UTC) | IST | Endpoint | Source | Purpose |
| --- | --- | --- | --- | --- |
| `1 16 * * *` | 21:31 | `/api/cron/roll-over-tasks` | HVA-169 | Stamp `rolled_over_at` on pending tasks whose `task_date` < today IST. |

Add new rows above as new cron-fired endpoints ship.

---

## Install on the VPS

1. SSH into the VPS as the `beakn` user.

2. Confirm `CRON_SECRET` is set in `/opt/beakn-home-visit-app/.env.local`. If
   missing, generate one (`openssl rand -hex 32`) and add the line; then
   `bash scripts/deploy.sh` to restart the container with the new secret.

3. Open the crontab editor:

   ```bash
   crontab -e
   ```

4. Append:

   ```cron
   # HVA-169 — pending-task roll-over (21:31 IST = 16:01 UTC)
   1 16 * * * curl -sS -X GET -H "Authorization: Bearer $(grep ^CRON_SECRET /opt/beakn-home-visit-app/.env.local | cut -d= -f2-)" https://visits.beakn.in/api/cron/roll-over-tasks >> /var/log/beakn-cron.log 2>&1
   ```

   The `$(grep ...)` substitution reads the live secret from the env file so
   the crontab line itself never holds a plaintext secret on disk. The
   logfile rotation is the operator's call (`logrotate` or manual).

5. Verify the line:

   ```bash
   crontab -l | grep roll-over
   ```

6. Smoke-test the endpoint manually (does NOT actually roll over anything if
   no eligible tasks exist):

   ```bash
   curl -sS -X GET \
     -H "Authorization: Bearer $(grep ^CRON_SECRET /opt/beakn-home-visit-app/.env.local | cut -d= -f2-)" \
     https://visits.beakn.in/api/cron/roll-over-tasks
   # → {"rolledOver":0,"auditWritten":0}
   ```

   Bad/missing token must return `401`:

   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://visits.beakn.in/api/cron/roll-over-tasks
   # → 401
   ```

---

## After a VPS rebuild or host crontab reset

User crontabs do NOT survive a fresh OS install. Re-run the install steps
above after any host rebuild. `scripts/deploy.sh` does not (and should not)
write to the user crontab automatically — host-level scheduling is an
operator concern, not a deploy concern.

---

## Why host crontab and not application scheduler

- The app runs as a single container (`beakn-app`). An app-internal
  `setInterval` would die on every `scripts/deploy.sh` rebuild.
- Host crontab survives container restarts and deploys.
- Bearer-token + HTTPS is the same auth model as Vercel Cron / GitHub Actions
  cron, so the endpoint code is portable if we ever migrate.
- `CRON_SECRET` lives in the same `.env.local` that the deploy script
  already manages; no new secret-store integration needed.
