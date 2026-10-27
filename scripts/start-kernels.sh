#!/bin/bash
# Start two federated NodeHost instances for local testing:
#   alfa on :3003 (ws) / :3013 (api)   — the control panel binds here
#   beta on :3004 (ws) / :3014 (api)
# Paths resolve relative to THIS script, so it works in any checkout
# (including inside a container) without edits.
set -e
BASE="$(cd "$(dirname "$0")/.." && pwd)"
KERNEL_DIR="$BASE/mini-services/nodehost-kernel"
LOG_DIR="$BASE/.zscripts"
mkdir -p "$LOG_DIR" "$BASE/db"

cd "$KERNEL_DIR"

# --- NodeHost Alfa (primary, control panel binds here) ---
PORT=3003 API_PORT=3013 \
DATABASE_URL="file:$BASE/db/host-alfa.db" \
HOST_CODE=alfa HOST_NAME="نودهاست آلفا" \
HOST_ADDRESS="http://127.0.0.1:3013/ingress" HOST_GW_PORT=3003 \
SEED_PROFILE=alfa \
bun --hot index.ts > "$LOG_DIR/kernel-alfa.log" 2>&1 &

# --- NodeHost Beta (second server in the federation demo) ---
PORT=3004 API_PORT=3014 \
DATABASE_URL="file:$BASE/db/host-beta.db" \
HOST_CODE=beta HOST_NAME="نودهاست بتا" \
HOST_ADDRESS="http://127.0.0.1:3014/ingress" HOST_GW_PORT=3004 \
SEED_PROFILE=beta PEER="alfa|نودهاست آلفا|http://127.0.0.1:3013/ingress|3003" \
bun --hot index.ts > "$LOG_DIR/kernel-beta.log" 2>&1 &

echo "kernels launched (alfa: 3003/3013, beta: 3004/3014)"
