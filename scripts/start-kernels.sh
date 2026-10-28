#!/bin/bash
# Start THIS server's NodeHost — exactly ONE kernel, zero simulation.
#
# Deployment model: each server runs ONE NodeHost instance. Other NodeHosts
# live on OTHER real servers and are federated via the Network tab (admin)
# or the PEER env var — never by spawning extra kernels locally.
# Demo nodes/fake peers are opt-in dev aids: SEED_PROFILE=alfa|beta.
set -e
BASE="$(cd "$(dirname "$0")/.." && pwd)"
KERNEL_DIR="$BASE/mini-services/nodehost-kernel"
LOG_DIR="$BASE/.zscripts"
mkdir -p "$LOG_DIR" "$BASE/db"
cd "$KERNEL_DIR"

# --- The one and only NodeHost of this server ---
# Values are set UNCONDITIONALLY (like the original script): ambient env vars
# from the host machine must never leak into the kernel config. Edit here or
# export NH_* vars before calling if you need custom values.
NH_DB="${NH_DB:-file:$BASE/db/host-alfa.db}"
NH_WS_PORT="${NH_WS_PORT:-3003}"
NH_API_PORT="${NH_API_PORT:-3013}"
NH_HOST_CODE="${NH_HOST_CODE:-alfa}"
NH_HOST_NAME="${NH_HOST_NAME:-نودهاست آلفا}"
NH_HOST_ADDR="${NH_HOST_ADDR:-http://127.0.0.1:3013/ingress}"

PORT="$NH_WS_PORT" API_PORT="$NH_API_PORT" \
NHP_LINK_SECRET="${NHP_LINK_SECRET:-}" \
DATABASE_URL="$NH_DB" \
HOST_CODE="$NH_HOST_CODE" HOST_NAME="$NH_HOST_NAME" \
HOST_ADDRESS="$NH_HOST_ADDR" HOST_GW_PORT="$NH_WS_PORT" \
SEED_PROFILE="${SEED_PROFILE:-}" \
bun --hot index.ts > "$LOG_DIR/kernel.log" 2>&1 &

echo "nodehost kernel launched (ws: $NH_WS_PORT / api: $NH_API_PORT, db: $NH_DB)"
