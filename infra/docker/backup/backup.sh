#!/usr/bin/env bash
# Daily pg_dump of beakn-postgres. Plain SQL + gzip — see infra/docker/backup/README.md
# for the format rationale.
#
# Reads DATABASE_URL from the container env (provided via --env-file at run time
# and re-exported below for cron's environment).
#
# Retention: 14 days. Files older than 14 days are deleted at the end of every
# successful run; a failure before that point leaves them in place.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[backup] FATAL: DATABASE_URL is not set" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"
out="$BACKUP_DIR/beakn-${timestamp}.sql.gz"
tmp="$out.partial"

echo "[backup] start  ts=$timestamp  target=$out" >&2

# --no-owner / --no-acl: dump portable across users (restore doesn't require the
#   exact role grants of prod).
# --clean --if-exists: DROP IF EXISTS each object before recreate, so restore is
#   idempotent without manual cleanup.
# Pipe through gzip on the fly; -9 keeps tarball ~25-30% of plain size at ~1ms/MB.
if pg_dump \
     --dbname="$DATABASE_URL" \
     --no-owner \
     --no-acl \
     --clean \
     --if-exists \
   | gzip -9 > "$tmp"; then
  mv "$tmp" "$out"
  size_bytes=$(stat -c%s "$out")
  echo "[backup] done   ts=$timestamp  size=${size_bytes}B  file=$out" >&2
else
  rm -f "$tmp"
  echo "[backup] FAILED ts=$timestamp" >&2
  exit 1
fi

# Retention pass — only runs after a successful dump. -mtime +14 means "modified
# more than 14*24 hours ago". -delete only removes files (not dirs).
deleted=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'beakn-*.sql.gz' -mtime "+$RETENTION_DAYS" -print -delete | wc -l)
echo "[backup] purge  retention=${RETENTION_DAYS}d  removed=$deleted" >&2
