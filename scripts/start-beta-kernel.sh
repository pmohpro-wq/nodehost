#!/bin/bash
# Start a SECOND NodeHost kernel for local federation testing.
# This is for development/testing only — production runs ONE kernel per server.
set -e
BASE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BASE/mini-services/nodehost-kernel"
mkdir -p "$BASE/.zscripts"
exec env PORT=3004 API_PORT=3014 \
  DATABASE_URL="file:$BASE/db/host-beta.db" \
  HOST_CODE="beta" HOST_NAME="نودهاست بتا" \
  HOST_ADDRESS="http://127.0.0.1:3014/ingress" HOST_GW_PORT=3004 \
  bun --hot index.ts
