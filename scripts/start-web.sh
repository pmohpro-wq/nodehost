#!/bin/bash
# Start NodeHost web app in PRODUCTION mode (standalone build).
# Same spawn pattern as start-kernels.sh — plain background child of this
# script, which is the pattern that reliably survives in this sandbox.
# Run `bun run build` first.
set -e
BASE="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$BASE/.zscripts"
mkdir -p "$LOG_DIR"

# Free :3000 from any previous server.
for P in $(pgrep -f 'server.js' 2>/dev/null); do kill -9 "$P" 2>/dev/null || true; done
for P in $(pgrep -f 'next-server|next dev' 2>/dev/null); do kill -9 "$P" 2>/dev/null || true; done
sleep 1

cd "$BASE"
PORT=3000 \
HOSTNAME=127.0.0.1 \
NODE_ENV=production \
DATABASE_URL="file:$BASE/db/host-alfa.db" \
NH_KERNEL_API="http://127.0.0.1:3013" \
bun .next/standalone/server.js > "$LOG_DIR/web.log" 2>&1 &

for i in $(seq 1 30); do
  sleep 1
  if curl -sf -m 2 http://127.0.0.1:3000/api/nh/bootstrap >/dev/null 2>&1; then
    echo "web (production) up"
    exit 0
  fi
done
echo "web FAILED to start — last log:" >&2
tail -20 "$LOG_DIR/web.log" >&2
exit 1
