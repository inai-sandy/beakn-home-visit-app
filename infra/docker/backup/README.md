# Beakn Postgres backups

Daily `pg_dump` of `beakn-postgres`, gzipped, kept on a named Docker volume
for 14 days. Runs under cron inside a tiny dedicated container —
**`beakn-postgres-backup`** — so it survives reboots without host-level
`/etc/cron.d` access (the `beakn` user has no sudo).

## Architecture at a glance

```
  beakn-postgres-backup  (alpine + postgresql16-client + busybox crond)
        │
        │ pg_dump --dbname=$DATABASE_URL | gzip > /backups/beakn-YYYYMMDD-HHMMSS.sql.gz
        ▼
  Named volume: beakn-postgres-backups  (/var/lib/docker/volumes/beakn-postgres-backups/_data)
        │
        │ also mounted RO into beakn-app at /backups
        ▼
  /dev/backup-health  (server component reading directory listing)
```

## Schedule

Cron entry:
```
0 2 * * * /usr/local/bin/backup.sh >> /proc/1/fd/2 2>&1
```

Container is started with `TZ=Asia/Kolkata` (set in the image), so this fires
at **02:00 IST every day**. No UTC math required.

## Dump format

**Plain SQL + gzip**, not `-Fc` custom format. Why:
- Human-readable post-`gunzip`. You can `grep`, `diff`, or selectively
  apply chunks.
- Restore is a one-liner: `gunzip -c file.sql.gz | psql …`. No `pg_restore`
  binary required.
- Compression ratio is roughly 25–30% of plain — the size difference vs.
  `-Fc` at our scale (<100 MB DB) is negligible.
- `--clean --if-exists` means restore is idempotent: drops each object
  before recreate, won't fail if the target already has tables.
- `--no-owner --no-acl` means the dump restores under whichever role you
  use; we don't carry prod's exact GRANT/REVOKE around.

## Retention

14 days, enforced inside `backup.sh` with:
```
find /backups -maxdepth 1 -type f -name 'beakn-*.sql.gz' -mtime +14 -delete
```

Only runs after a successful dump — if `pg_dump` fails, old files stay put.

## Day-to-day operations

| Action | Command |
|---|---|
| Tail logs | `docker logs -f beakn-postgres-backup` |
| Manual backup now | `docker exec beakn-postgres-backup /usr/local/bin/backup.sh` |
| List backups | `docker exec beakn-postgres-backup ls -la /backups/` |
| Copy a backup to host | `docker cp beakn-postgres-backup:/backups/beakn-YYYYMMDD-HHMMSS.sql.gz ~/` |
| Inspect a backup | `docker exec beakn-postgres-backup sh -c 'gunzip -c /backups/beakn-….sql.gz \| head'` |
| Restart container | `docker restart beakn-postgres-backup` |
| Rebuild image | `docker build -t beakn-postgres-backup:latest infra/docker/backup/ && docker rm -f beakn-postgres-backup && docker run -d --name beakn-postgres-backup --network mcp-network --restart unless-stopped --env-file /opt/beakn-home-visit-app/.env.local -v beakn-postgres-backups:/backups beakn-postgres-backup:latest` |
| App-side health | `curl https://visits.beakn.in/dev/backup-health` |

## Restore procedure

This was verified end-to-end during HVA-20 (see PR #9 description). Pick the
latest dump and restore into a **scratch DB**, never directly over prod, until
you've confirmed the contents look right.

### 1 — pick a backup

```bash
docker exec beakn-postgres-backup ls -la /backups/
# Note the filename you want, e.g. beakn-20260515-012412.sql.gz
```

### 2 — restore into a fresh scratch DB

```bash
# Create scratch DB (safe to drop — never points at the live app).
docker exec beakn-postgres psql -U beakn_app -d postgres \
  -c "CREATE DATABASE beakn_restore_test OWNER beakn_app;"

# Stream the gzipped dump straight into psql.
docker cp beakn-postgres-backup:/backups/beakn-20260515-012412.sql.gz /tmp/restore.sql.gz
gunzip -c /tmp/restore.sql.gz \
  | docker exec -i beakn-postgres psql -U beakn_app -d beakn_restore_test
rm /tmp/restore.sql.gz
```

### 3 — sanity-check the restored data

```bash
docker exec beakn-postgres psql -U beakn_app -d beakn_restore_test -c "
SELECT 'config', count(*) FROM config
UNION ALL SELECT 'audit_log', count(*) FROM audit_log
UNION ALL SELECT 'visit_requests', count(*) FROM visit_requests;"

# Confirm uuid_generate_v7() came along (it's a plpgsql function from the migration).
docker exec beakn-postgres psql -U beakn_app -d beakn_restore_test -c "SELECT uuid_generate_v7();"
```

Counts should match `beakn_app` for the same tables (or match the moment in
time the backup was taken, if data has changed since).

### 4 — clean up

```bash
docker exec beakn-postgres psql -U beakn_app -d postgres \
  -c "DROP DATABASE beakn_restore_test;"
```

### Restoring over production

**Don't do this without an outage window + a fresh backup taken just before
the restore.** When you do:

1. Stop the app: `docker stop beakn-app`. (`pnpm db:psql` users out too.)
2. Take a fresh backup: `docker exec beakn-postgres-backup /usr/local/bin/backup.sh`.
3. Decide: in-place restore (uses `--clean --if-exists` to drop and recreate every
   object) vs. swap DBs (restore into `beakn_app_new`, then rename `beakn_app` →
   `beakn_app_old` and `beakn_app_new` → `beakn_app`). Swap is safer if disk allows.
4. For in-place:
   ```bash
   gunzip -c /backups/beakn-….sql.gz \
     | docker exec -i beakn-postgres psql -U beakn_app -d beakn_app
   ```
5. Restart app: `docker start beakn-app`. Confirm `/api/health` returns 200 and
   row counts match expectations.

## Not in scope for Phase 1

- **Off-site / cloud backups.** Today everything lives on the same VPS disk
  (`/var/lib/docker/volumes/beakn-postgres-backups/_data`). If the host dies,
  so do the backups. Phase 2 will add S3-compatible upload (Hostinger object
  storage, R2, B2, …) — pick during build. The existing backup.sh has the
  shape this'll plug into (one `aws s3 cp` line after the `mv`).
- **Encryption-at-rest of the dumps.** Postgres ships unencrypted; gzip
  doesn't help confidentiality. If/when secrets land in customer rows,
  encrypt with `gpg --symmetric` before write.
- **Per-table or partial backups.** `pg_dump` supports `-t table` filters;
  not wired in today because the schema is small and a full dump is fast.

## Why no host-level cron

The Linear AC originally specified "host-level cron on the VPS". The `beakn`
user has no sudo, so writing to `/etc/cron.d/` or `/etc/crontab` is
impossible without involving an external admin every time we change a
schedule. Docker-based cron meets the same intent (daily automated dump,
retention, restore docs) and matches the rest of the infra
(`beakn-postgres`, `beakn-app`, `caddy` — all containers on `mcp-network`).

Trade-offs of the Docker approach:
- ✔ Schedule changes are a git change + container restart, no root needed.
- ✔ Logs go to `docker logs` (same plane as the rest of the stack).
- ✘ If the host clock drifts, container clock drifts with it (same as host cron).
- ✘ If the Docker daemon is down, no backups fire (same as host cron + systemd-down).
