#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# HVA-262: regenerate + publish the manual's walkthrough videos
# =============================================================================
#
# Usage (from the repo root, as the beakn user):
#   pnpm test:e2e --config=playwright.videos.config.ts   # record
#   bash scripts/publish-videos.sh                        # convert + publish
#
# What it does:
#   1. Finds every video.webm under test-results/videos/
#   2. Converts each to a phone-friendly H.264 mp4 (iPhone Safari can't
#      play Playwright's webm)
#   3. Publishes to /var/www/docs/videos/ THROUGH the filebrowser
#      container — /var/www/docs is root-owned; filebrowser mounts the
#      host filesystem read-write at /srv, so `docker exec` is our
#      no-sudo write path. Served at https://docs.1site.ai/videos/
#
# Output filename = the spec directory's leading slug (e.g.
# "today-loop.record-..." → today-loop.mp4), so specs map 1:1 to URLs.
# =============================================================================

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/test-results/videos"

if ! command -v ffmpeg >/dev/null; then
  echo "[videos] ffmpeg not found on host — cannot convert" >&2
  exit 1
fi

found=0
while IFS= read -r webm; do
  found=1
  dir_name="$(basename "$(dirname "$webm")")"
  slug="${dir_name%%.record-*}"
  mp4="/tmp/${slug}.mp4"
  echo "[videos] converting $dir_name → ${slug}.mp4"
  ffmpeg -loglevel error -i "$webm" \
    -c:v libx264 -pix_fmt yuv420p -movflags +faststart -crf 26 -y "$mp4"
  echo "[videos] publishing ${slug}.mp4 → docs.1site.ai/videos/"
  docker exec filebrowser sh -c 'mkdir -p /srv/var/www/docs/videos'
  docker exec -i filebrowser sh -c \
    "cat > /srv/var/www/docs/videos/${slug}.mp4 && chmod 644 /srv/var/www/docs/videos/${slug}.mp4" \
    < "$mp4"
  rm -f "$mp4"
done < <(find "$OUT_DIR" -name 'video.webm' 2>/dev/null)

# ---------------------------------------------------------------------------
# HVA-264: manual screenshots — publish every PNG under
# test-results/manual-shots/ to /var/www/docs/images/manual/.
# Captured by tests/videos/manual-shots.capture.spec.ts.
# ---------------------------------------------------------------------------
# Two screenshot sets: exec manual (manual-shots → images/manual) and
# captain manual (captain-shots → images/captain-manual, HVA-265).
publish_shots() {
  local src_dir="$1" dest_dir="$2"
  [ -d "$src_dir" ] || return 0
  docker exec filebrowser sh -c "mkdir -p /srv/var/www/docs/images/${dest_dir}"
  local shot_count=0
  for png in "$src_dir"/*.png; do
    [ -e "$png" ] || continue
    local name
    name="$(basename "$png")"
    docker exec -i filebrowser sh -c \
      "cat > /srv/var/www/docs/images/${dest_dir}/${name} && chmod 644 /srv/var/www/docs/images/${dest_dir}/${name}" \
      < "$png"
    shot_count=$((shot_count + 1))
  done
  echo "[videos] published $shot_count screenshots → images/${dest_dir}/"
  [ "$shot_count" -gt 0 ] && found=1
  return 0
}
publish_shots "$ROOT/test-results/manual-shots" "manual"
publish_shots "$ROOT/test-results/captain-shots" "captain-manual"

if [ "$found" -eq 0 ]; then
  echo "[videos] nothing found — run the recording config first" >&2
  exit 1
fi

echo "[videos] done"
