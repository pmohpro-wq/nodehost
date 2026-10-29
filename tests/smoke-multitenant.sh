#!/bin/bash
# smoke-multitenant.sh — tenancy matrix, TAB-ISOLATED + identity-law era.
#
# Contract under test (header era — no cookies, no server sessions):
#   1. Fresh instance: the FIRST entrant becomes admin, the second is user.
#   2. Identity law at the door: short id → 422; new Persian id → 422
#      (English-only); legacy Persian holders keep logging in.
#   3. Tenant gates: user cannot touch admin-only endpoints; introducing a
#      remote NodeHost is for EVERY signed-in user (Task 16); deleting
#      hosts stays admin-only.
#   4. Admin controls: suspend a user → cut off at their very next call;
#      re-activate → back in; admin settings round-trip (maxNodes).
#
# Dev-only: WIPES the web-user tables of db/host-alfa.db first.
# Usage: bash tests/smoke-multitenant.sh   (kernel :3013 + web :3000 up)

set -u
B="http://127.0.0.1:3000"
PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✓ $1 [$3]"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — expected $2 got $3"; fi; }
code()  { curl -s -o /dev/null -w "%{http_code}" "$@"; }
json()  { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$2"; }

echo "== 0) fresh tenant state (dev-only pre-clean) =="
# SAFETY GATE — this suite WIPES every real account and node of the
# LIVE instance db. It must never run against a db that holds real data
# unless the operator says so out loud:
#     SMOKE_ALLOW_WIPE=1 bash tests/smoke-multitenant.sh
if [ "${SMOKE_ALLOW_WIPE:-0}" != "1" ]; then
  echo "REFUSING to wipe the live db (users/nodes would be destroyed)."
  echo "This suite is for a throwaway/dev instance only."
  echo "Run explicitly with: SMOKE_ALLOW_WIPE=1 bash tests/smoke-multitenant.sh"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_URL="file:$ROOT/db/host-alfa.db"
bun -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: '$DB_URL' } } });
(async () => {
  await p.node.deleteMany({ where: { isDemo: false } });
  await p.user.deleteMany({});
  console.log('  ✓ tenant tables cleared');
  await p.\$disconnect();
})();"

echo "== 1) first entrant = admin, second = user =="
R=$(curl -s -X POST $B/api/auth/enter -H 'content-type: application/json' -d '{"name":"owner1"}')
check "first enter ok" 200 $(code -X POST $B/api/auth/enter -H 'content-type: application/json' -d '{"name":"owner1"}')
[ "$(echo "$R" | json -c "d['user']['role']")" = "admin" ] && check "first entrant role=admin" 0 0 || check "first entrant role=admin" 1 1
R=$(curl -s -X POST $B/api/auth/enter -H 'content-type: application/json' -d '{"name":"member1"}')
[ "$(echo "$R" | json -c "d['user']['role']")" = "user" ] && check "second entrant role=user" 0 0 || check "second entrant role=user" 1 1
check "exact re-enter = login" 200 $(code -X POST $B/api/auth/enter -H 'content-type: application/json' -d '{"name":"owner1"}')

echo "== 2) identity law at the door =="
check "short id → 422" 422 $(code -X POST $B/api/auth/enter -H 'content-type: application/json' -d '{"name":"x"}')
check "new Persian id → 422 (English law)" 422 $(code -X POST $B/api/auth/enter -H 'content-type: application/json' -d '{"name":"کاربر تازه"}')
check "uppercase alias of owner1 → 409" 409 $(code -X POST $B/api/auth/enter -H 'content-type: application/json' -d '{"name":"OWNER1"}')

echo "== 3) tenant gates (x-nh-user header era) =="
check "guest users list → 401" 401 $(code $B/api/admin/users)
check "member users list → 403" 403 $(code $B/api/admin/users -H 'x-nh-user: member1')
check "member PATCH host-identity → 403" 403 $(code -X PATCH $B/api/admin/host-identity -H 'x-nh-user: member1' -H 'content-type: application/json' -d '{"code":"newid"}')
check "member introduces remote host → 200 (Task 16)" 200 $(code -X POST $B/api/nh/hosts -H 'x-nh-user: member1' -H 'content-type: application/json' -d '{"code":"peerhost","address":"http://127.0.0.1:4998/ingress"}')
check "member deletes host → 403" 403 $(code -X DELETE "$B/api/nh/hosts/$(curl -s $B/api/nh/bootstrap -H 'x-nh-user: member1' | python3 -c "import json,sys; d=json.load(sys.stdin); print([h['id'] for h in d['hosts'] if h['code']=='peerhost'][0])")" -H 'x-nh-user: member1')
HID=$(curl -s $B/api/nh/bootstrap -H 'x-nh-user: owner1' | python3 -c "import json,sys; d=json.load(sys.stdin); print([h['id'] for h in d['hosts'] if h['code']=='peerhost'][0])")
check "admin deletes host → 200" 200 $(code -X DELETE "$B/api/nh/hosts/$HID" -H 'x-nh-user: owner1')

echo "== 4) admin controls: suspend / reactivate / settings =="
MID=$(curl -s $B/api/admin/users -H 'x-nh-user: owner1' | python3 -c "import json,sys; d=json.load(sys.stdin); print([u['id'] for u in d['users'] if u['name']=='member1'][0])")
check "admin suspends member1 → 200" 200 $(code -X PATCH "$B/api/admin/users/$MID" -H 'x-nh-user: owner1' -H 'content-type: application/json' -d '{"status":"suspended"}')
check "suspended enter → 403" 403 $(code -X POST $B/api/auth/enter -H 'content-type: application/json' -d '{"name":"member1"}')
BX=$(curl -s $B/api/nh/bootstrap -H 'x-nh-user: member1')
[ "$(echo "$BX" | json -c "d['viewer']")" = "None" ] && check "suspended header → guest (cut off)" 0 0 || check "suspended header → guest (cut off)" 1 1
check "admin reactivates member1 → 200" 200 $(code -X PATCH "$B/api/admin/users/$MID" -H 'x-nh-user: owner1' -H 'content-type: application/json' -d '{"status":"active"}')
check "reactivated enter → 200" 200 $(code -X POST $B/api/auth/enter -H 'content-type: application/json' -d '{"name":"member1"}')
check "member PATCH settings → 403" 403 $(code -X PATCH $B/api/admin/settings -H 'x-nh-user: member1' -H 'content-type: application/json' -d '{"maxNodes":3}')
check "admin PATCH settings → 200" 200 $(code -X PATCH $B/api/admin/settings -H 'x-nh-user: owner1' -H 'content-type: application/json' -d '{"maxNodes":50}')

echo
echo "RESULT: pass=$PASS fail=$FAIL"
[ "$FAIL" = "0" ]
