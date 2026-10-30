#!/bin/bash
# Test host identity change end-to-end in a single session so the kernel
# stays alive for the whole test.
set -e
BASE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BASE"

# Kill any stale kernel
pkill -f 'bun --hot index.ts' 2>/dev/null || true
sleep 1

# Restore db host code to zzz if it was changed in a previous run
bun -e "
import { Database } from 'bun:sqlite'
const db = new Database('db/host-alfa.db')
const row = db.query('SELECT code FROM Host WHERE kind = ?').get('local') as {code:string}|null
if (row && row.code !== 'zzz') {
  db.run('UPDATE Host SET code = ? WHERE kind = ?', 'zzz', 'local')
  console.log('restored host code from', row.code, '→ zzz')
} else {
  console.log('host code already', row?.code ?? 'none')
}
"

echo "[setup] starting alfa kernel..."
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
  if curl -sf -m 2 http://127.0.0.1:3013/.well-known/nhp >/dev/null 2>&1; then
    echo "[setup] alfa up"
    break
  fi
done

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
echo "=== TEST 1: login as vvv (admin) ==="
RES=$(curl -s -c /tmp/nh-cookies.txt -X POST http://127.0.0.1:3000/api/auth/enter \
  -H 'content-type: application/json' -d '{"name":"vvv"}')
echo "  $RES"
OK=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print('true' if d.get('ok') else 'false')")
check "login ok" "$OK" "true"

echo ""
echo "=== TEST 2: PATCH /api/admin/host-identity {code:'myhost'} ==="
RES=$(curl -s -b /tmp/nh-cookies.txt -X PATCH http://127.0.0.1:3000/api/admin/host-identity \
  -H 'content-type: application/json' -H 'x-nh-user: vvv' -d '{"code":"myhost"}')
echo "  response: $RES"
OK=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print('true' if d.get('ok') else 'false')")
check "host id change ok" "$OK" "true"

echo ""
echo "=== TEST 3: bootstrap shows new id ==="
RES=$(curl -s -b /tmp/nh-cookies.txt http://127.0.0.1:3000/api/nh/bootstrap)
CODE=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['host']['code'])")
echo "  host.code = $CODE"
check "bootstrap shows 'myhost'" "$CODE" "myhost"

echo ""
echo "=== TEST 4: invalid id (Persian) → reject ==="
RES=$(curl -s -b /tmp/nh-cookies.txt -X PATCH http://127.0.0.1:3000/api/admin/host-identity \
  -H 'content-type: application/json' -H 'x-nh-user: vvv' -d '{"code":"نودهاست-فارسی"}')
echo "  response: $RES"
OK=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print('false' if d.get('ok')==False else 'other')")
check "Persian id rejected" "$OK" "false"

echo ""
echo "=== TEST 5: invalid id (with underscore) → reject ==="
RES=$(curl -s -b /tmp/nh-cookies.txt -X PATCH http://127.0.0.1:3000/api/admin/host-identity \
  -H 'content-type: application/json' -H 'x-nh-user: vvv' -d '{"code":"my_host"}')
echo "  response: $RES"
OK=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print('false' if d.get('ok')==False else 'other')")
check "underscore id rejected" "$OK" "false"

echo ""
echo "=== TEST 6: too short (1 char) → reject ==="
RES=$(curl -s -b /tmp/nh-cookies.txt -X PATCH http://127.0.0.1:3000/api/admin/host-identity \
  -H 'content-type: application/json' -H 'x-nh-user: vvv' -d '{"code":"a"}')
echo "  response: $RES"
OK=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print('false' if d.get('ok')==False else 'other')")
check "1-char id rejected" "$OK" "false"

echo ""
echo "=== TEST 7: restore to zzz (cleanup) ==="
RES=$(curl -s -b /tmp/nh-cookies.txt -X PATCH http://127.0.0.1:3000/api/admin/host-identity \
  -H 'content-type: application/json' -H 'x-nh-user: vvv' -d '{"code":"zzz"}')
echo "  response: $RES"
OK=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print('true' if d.get('ok') else 'false')")
check "restore ok" "$OK" "true"

echo ""
echo "=== SUMMARY ==="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"

# Cleanup
pkill -f 'bun --hot index.ts' 2>/dev/null || true

[ $FAIL -eq 0 ] && exit 0 || exit 1
