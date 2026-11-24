#!/bin/sh
# Stop spend for the t1d-open-desk Worker. Default is dry-run.
# Usage: scripts/kill-switch.sh [--dry-run|--execute|--help]
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
WORKER=t1d-open-desk
MODE=dry-run
URL="${T1D_OPEN_DESK_URL:-}"

usage() {
  sed -n '2,3p' "$0" | sed 's/^# //'
  echo "Default: --dry-run. Refuses to run --execute unless you pass it explicitly."
  echo "Optional: T1D_OPEN_DESK_URL for the post-delete HTTP check."
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) MODE=dry-run ;;
    --execute) MODE=execute ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required" >&2
  exit 1
fi
if [ ! -x "$ROOT/node_modules/.bin/cf" ]; then
  echo "Install project dependencies first: npm install" >&2
  exit 1
fi

echo "Project: $ROOT"
echo "Worker:  $WORKER"
echo "Mode:    $MODE"

if [ "$MODE" = "dry-run" ]; then
  echo "Preview only. Not deleting the Worker."
  npx --no-install cf workers delete "$WORKER" --dry-run
  echo "Dry run finished. Re-run with --execute to delete $WORKER and its workers.dev route."
  exit 0
fi

echo "Deleting $WORKER, including its workers.dev route."
npx --no-install cf workers delete "$WORKER" --force

echo "Verifying the Worker is gone..."
if npx --no-install cf workers list 2>/dev/null | grep -q "$WORKER"; then
  echo "WARNING: $WORKER still appears in cf workers list." >&2
  exit 1
fi
echo "cf workers list does not include $WORKER."

if [ -n "$URL" ]; then
  echo "Requesting $URL"
  CODE=$(curl -sS -o /tmp/t1d-kill-switch-body --max-time 20 -w "%{http_code}" "$URL" || true)
  echo "HTTP status: ${CODE:-unavailable}"
  if grep -q "T1D OPEN DESK" /tmp/t1d-kill-switch-body 2>/dev/null; then
    echo "WARNING: the homepage still looks live." >&2
    exit 1
  fi
else
  echo "Set T1D_OPEN_DESK_URL to the workers.dev URL to confirm the homepage is gone."
fi

echo "Kill switch complete. Reassess the plan before restoring with:"
echo "  npx --no-install cf deploy --no-provision"
