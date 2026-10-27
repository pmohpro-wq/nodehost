#!/bin/bash
# Start both federated NodeHost instances (alfa on :3003/3013, beta on :3004/3014)
cd /home/z/my-project/mini-services/nodehost-kernel

# --- NodeHost Alfa (primary, control panel binds here) ---
PORT=3003 API_PORT=3013 \
DATABASE_URL="file:/home/z/my-project/db/host-alfa.db" \
HOST_CODE=alfa HOST_NAME="نودهاست آلفا" \
HOST_ADDRESS="http://127.0.0.1:3013/ingress" HOST_GW_PORT=3003 \
SEED_PROFILE=alfa \
bun --hot index.ts > /home/z/my-project/.zscripts/kernel-alfa.log 2>&1 &

# --- NodeHost Beta (second server in the federation demo) ---
PORT=3004 API_PORT=3014 \
DATABASE_URL="file:/home/z/my-project/db/host-beta.db" \
HOST_CODE=beta HOST_NAME="نودهاست بتا" \
HOST_ADDRESS="http://127.0.0.1:3014/ingress" HOST_GW_PORT=3004 \
SEED_PROFILE=beta PEER="alfa|نودهاست آلفا|http://127.0.0.1:3013/ingress|3003" \
bun --hot index.ts > /home/z/my-project/.zscripts/kernel-beta.log 2>&1 &

echo "kernels launched"
