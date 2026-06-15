#!/usr/bin/env bash
# scripts/cleanup-playground.sh
#
# Sweeps stale pipeline scratch directories left behind by crashed workers.
# Safe to run anytime — the worker deletes its own run dir on success, so
# anything older than the configured threshold is by definition orphaned.
#
# Cron suggestion (VPS):
#     0 3 * * * /opt/stylemd/scripts/cleanup-playground.sh >> /var/log/stylemd-cleanup.log 2>&1

set -euo pipefail

ROOT="${STYLEMD_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PLAYGROUND="$ROOT/.playground/stylemd-artifact-runs"
KEEP_HOURS="${PLAYGROUND_KEEP_HOURS:-24}"   # delete dirs older than this

if [ ! -d "$PLAYGROUND" ]; then
  echo "[cleanup] $PLAYGROUND not present; nothing to do."
  exit 0
fi

before=$(du -sh "$PLAYGROUND" 2>/dev/null | awk '{print $1}')
count_before=$(find "$PLAYGROUND" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')

# Delete directories last-modified more than KEEP_HOURS ago.
deleted=0
while IFS= read -r dir; do
  rm -rf "$dir"
  deleted=$((deleted + 1))
done < <(find "$PLAYGROUND" -mindepth 1 -maxdepth 1 -type d -mmin +$((KEEP_HOURS * 60)))

after=$(du -sh "$PLAYGROUND" 2>/dev/null | awk '{print $1}')
count_after=$(find "$PLAYGROUND" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')

echo "[cleanup] $(date -Iseconds) playground=$PLAYGROUND keep_hours=$KEEP_HOURS"
echo "[cleanup]   before: $count_before dirs / $before"
echo "[cleanup]   after:  $count_after dirs / $after  (deleted $deleted)"
