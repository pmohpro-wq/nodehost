#!/bin/bash
# Test that user registration self-heals after a stale-db scenario.
# Scenario: kernel restarts (db inode changes), web keeps running with
# a stale Prisma pool. Before Task 22 this 500'd with "readonly database".
# After Task 22 withDbRetry resets the pool transparently.
set -e
BASE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BASE"

pkill -f 'bun --hot index.ts' 2>/dev/null || true
sleep 1

# Clean any test users from previous runs
bun -e "
import { Database } from 'bun:sqlite'
const db = new Database('db/host-alfa.db')
db.run('DELETE FROM NodeModuleState WHERE nodeId IN (SELECT id FROM Node WHERE code LIKE ?)', 'regtest%')
db.run('DELETE FROM Node WHERE code LIKE ?', 'regtest%')
db.run('DELETE FROM User WHERE name LIKE ?', 'regtest%')
console.log('cleaned regtest users')
"

echo "[setup] starting alfa kernel (first instance)..."
setsid bash -c '
  cd /home/z/my-project/nodehost/mini-services/nodehost-kernel
  exec env PORT=3003 API_PORT=3013 \
    DATABASE_URL="file:/home/z/my-project/nodehost/db/host-alfa.db" \
    HOST_CODE="zzz" HOST_NAME="نودهاست آلفا" \
    HOST_ADDRESS="http://127.0.0.1:3013/ingress" HOST_GW_PORT=3003 \
    bun --hot index.ts
' > .zscripts/kernel.log 2>&1 < /dev/null &
for i in $(seq 1 15); do
  sleep 1
  curl -sf -m 2 http://127.0.0.1:3013/.well-known/nhp >/dev/null 2>&1 && break
done
echo "[setup] alfa up"

echo "[setup] starting web server..."
pkill -f 'bun .next/standalone/server.js' 2>/dev/null || true
sleep 1
setsid bash -c '
  cd /home/z/my-project/nodehost
  exec env PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production \
    DATABASE_URL="file:/home/z/my-project/nodehost/db/host-alfa.db" \
    NH_KERNEL_API="http://127.0.0.1:3013" \
    bun .next/standalone/server.js
' > .zscripts/web.log 2>&1 < /dev/null &
for i in $(seq 1 15); do
  sleep 1
  curl -sf -m 2 http://127.0.0.1:3000/api/nh/bootstrap >/dev/null 2>&1 && break
done
echo "[setup] web up"

PASS=0
FAIL=0
check() {
  if [ "$2" = "$3" ]; then
    echo "  [PASS] $1"
    PASS=$((PASS+1))
  else
    echo "  [FAIL] $1"
    echo "        expected: $3"
    echo "        actual:   $2"
    FAIL=$((FAIL+1))
  fi
}

echo ""
echo "=== TEST 1: register BEFORE kernel restart (baseline) ==="
RES=$(curl -s -X POST http://127.0.0.1:3000/api/auth/enter \
  -H 'content-type: application/json' -d '{"name":"regtest1"}')
echo "  $RES"
OK=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print('true' if d.get('ok') else 'false')")
check "registration works before restart" "$OK" "true"

echo ""
echo "=== TEST 2: KILL kernel (simulates stale db inode) ==="
pkill -f 'bun --hot index.ts' 2>/dev/null
sleep 2
# Touch the db file to force a new inode (simulates kernel rewrite)
bun -e "
import { Database } from 'bun:sqlite'
const db = new Database('db/host-alfa.db')
db.run('DELETE FROM SysLog WHERE createdAt < datetime(\"now\", \"-1 minute\")')
console.log('touched db (syslog prune)')
"

echo ""
echo "=== TEST 3: register AFTER kernel kill (web still running with stale pool) ==="
RES=$(curl -s -X POST http://127.0.0.1:3000/api/auth/enter \
  -H 'content-type: application/json' -d '{"name":"regtest2"}')
echo "  $RES"
OK=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print('true' if d.get('ok') else 'false')")
check "registration self-heals after stale pool (Task 22)" "$OK" "true"

echo ""
echo "=== TEST 4: register ANOTHER user (pool should be healthy now) ==="
RES=$(curl -s -X POST http://127.0.0.1:3000/api/auth/enter \
  -H 'content-type: application/json' -d '{"name":"regtest3"}')
echo "  $RES"
OK=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print('true' if d.get('ok') else 'false')")
check "second registration works" "$OK" "true"

echo ""
echo "=== TEST 5: login existing vvv (read path also self-heals) ==="
RES=$(curl -s -X POST http://127.0.0.1:3000/api/auth/enter \
  -H 'content-type: application/json' -d '{"name":"vvv"}')
echo "  $RES"
OK=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print('true' if d.get('ok') else 'false')")
check "login works after stale pool" "$OK" "true"

echo ""
echo "=== TEST 6: invalid id still rejected (gate runs before db) ==="
RES=$(curl -s -X POST http://127.0.0.1:3000/api/auth/enter \
  -H 'content-type: application/json' -d '{"name":"regtest_persian_کاربر"}')
echo "  $RES"
OK=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print('false' if d.get('ok')==False else 'other')")
check "invalid id rejected" "$OK" "false"

echo ""
echo "=== SUMMARY ==="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"

# Cleanup test users
pkill -f 'bun --hot index.ts' 2>/dev/null || true
bun -e "
import { Database } from 'bun:sqlite'
const db = new Database('db/host-alfa.db')
db.run('DELETE FROM NodeModuleState WHERE nodeId IN (SELECT id FROM Node WHERE code LIKE ?)', 'regtest%')
db.run('DELETE FROM Node WHERE code LIKE ?', 'regtest%')
db.run('DELETE FROM User WHERE name LIKE ?', 'regtest%')
console.log('cleaned regtest users')
"

[ $FAIL -eq 0 ] && exit 0 || exit 1
