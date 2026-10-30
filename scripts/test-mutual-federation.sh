#!/bin/bash
# Test the mutual federation handshake end-to-end:
#   1. start a beta kernel on 3004/3014 (if not already running)
#   2. probe with a dead URL → expect rejection
#   3. probe with a non-NodeHost URL → expect rejection
#   4. introduce BETA → expect mutual handshake (alfa knows beta, beta knows alfa)
#   5. idempotent re-introduce → expect ok without duplicate row
#   6. stop the beta kernel we started (if we started it)
set -e
BASE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BASE"

ALFA_API="http://127.0.0.1:3013"
BETA_API="http://127.0.0.1:3014"

STARTED_BETA=0
if ! curl -sf -m 2 "$BETA_API/.well-known/nhp" >/dev/null 2>&1; then
  echo "[setup] starting beta kernel..."
  setsid bash scripts/start-beta-kernel.sh > .zscripts/kernel-beta.log 2>&1 < /dev/null &
  for i in $(seq 1 15); do
    sleep 1
    if curl -sf -m 2 "$BETA_API/.well-known/nhp" >/dev/null 2>&1; then
      STARTED_BETA=1
      break
    fi
  done
  if [ $STARTED_BETA -eq 0 ]; then
    echo "[FAIL] beta kernel did not start" >&2
    cat .zscripts/kernel-beta.log >&2
    exit 1
  fi
  echo "[setup] beta kernel up (we started it)"
else
  echo "[setup] beta kernel already running"
fi

PASS=0
FAIL=0
check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  [PASS] $name"
    PASS=$((PASS+1))
  else
    echo "  [FAIL] $name"
    echo "        expected: $expected"
    echo "        actual:   $actual"
    FAIL=$((FAIL+1))
  fi
}

echo ""
echo "=== TEST 1: dead address is rejected ==="
RES=$(curl -s -X POST "$ALFA_API/internal/hosts" -H 'content-type: application/json' -d '{"address":"http://192.0.2.123:9999/ingress"}')
echo "  response: $RES"
OK=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print('false' if d.get('ok')==False else 'other')")
check "dead address rejected with ok=false" "false" "$OK"

echo ""
echo "=== TEST 2: non-NodeHost URL is rejected ==="
RES=$(curl -s -X POST "$ALFA_API/internal/hosts" -H 'content-type: application/json' -d '{"address":"https://example.com/"}')
echo "  response: $RES"
OK=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print('false' if d.get('ok')==False else 'other')")
check "non-nodehost URL rejected with ok=false" "false" "$OK"

echo ""
echo "=== TEST 3: introduce BETA to ALFA (mutual handshake) ==="
RES=$(curl -s -X POST "$ALFA_API/internal/hosts" -H 'content-type: application/json' -d '{"address":"http://127.0.0.1:3014/ingress"}')
echo "  response: $RES"
OK=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print('true' if d.get('ok')==True else 'other')")
check "introduce succeeded with ok=true" "true" "$OK"
MUTUAL=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print('true' if d.get('mutual')==True else 'false')")
check "mutual handshake completed (mutual=true)" "true" "$MUTUAL"
PEER_CODE=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('peer',{}).get('code',''))")
check "peer code discovered from well-known (=='beta')" "beta" "$PEER_CODE"

echo ""
echo "=== TEST 4: ALFA now knows BETA; BETA now knows ALFA ==="
ALFA_HOSTS=$(curl -s "$ALFA_API/internal/bootstrap" | python3 -c "import sys,json;d=json.load(sys.stdin);print(','.join(sorted(h['code'] for h in d.get('hosts',[]))))")
echo "  alfa's remote hosts: $ALFA_HOSTS"
check "alfa knows beta" "beta" "$ALFA_HOSTS"
BETA_HOSTS=$(curl -s "$BETA_API/internal/bootstrap" | python3 -c "import sys,json;d=json.load(sys.stdin);print(','.join(sorted(h['code'] for h in d.get('hosts',[]))))")
echo "  beta's remote hosts: $BETA_HOSTS"
check "beta knows alfa (mutual)" "zzz" "$BETA_HOSTS"

echo ""
echo "=== TEST 5: re-introduce is idempotent (no duplicate) ==="
RES=$(curl -s -X POST "$ALFA_API/internal/hosts" -H 'content-type: application/json' -d '{"address":"http://127.0.0.1:3014/ingress"}')
echo "  response: $RES"
OK=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print('true' if d.get('ok')==True else 'other')")
check "re-introduce ok=true" "true" "$OK"
ALFA_BETA_COUNT=$(curl -s "$ALFA_API/internal/bootstrap" | python3 -c "import sys,json;d=json.load(sys.stdin);print(sum(1 for h in d.get('hosts',[]) if h['code']=='beta'))")
check "exactly one 'beta' row in alfa" "1" "$ALFA_BETA_COUNT"

echo ""
echo "=== TEST 6: user-supplied code is IGNORED (peer id is authoritative) ==="
RES=$(curl -s -X POST "$ALFA_API/internal/hosts" -H 'content-type: application/json' -d '{"address":"http://127.0.0.1:3014/ingress","code":"evil-fake-code"}')
echo "  response: $RES"
PEER_CODE=$(echo "$RES" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('peer',{}).get('code',''))")
check "peer code is 'beta' (not 'evil-fake-code')" "beta" "$PEER_CODE"

echo ""
echo "=== SUMMARY ==="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"

# Cleanup: stop beta if we started it
if [ $STARTED_BETA -eq 1 ]; then
  echo "[cleanup] stopping beta kernel..."
  pkill -f 'bun --hot index.ts' 2>/dev/null || true
  sleep 1
  # restart alfa (since pkill above matched both)
  setsid bash scripts/start-kernels.sh > /dev/null 2>&1 < /dev/null &
  sleep 4
fi

[ $FAIL -eq 0 ] && exit 0 || exit 1
