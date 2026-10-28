#!/bin/bash
# Multi-tenant auth matrix smoke test — passwordless era (id = name).
# Runs against the running dev server (web :3000 + kernel :3013).
set -e
B="http://127.0.0.1:3000"
JA=/tmp/nh-admin.jar; JU=/tmp/nh-user.jar; J2=/tmp/nh-user2.jar
rm -f $JA $JU $J2
PASS=0; FAIL=0
check() { # name expected_code actual_code
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✓ $1 [$3]"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — expected $2 got $3"; fi
}
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

echo "== 0) fresh tenant state (dev-only pre-clean) =="
# This matrix checks the FIRST-entrant-becomes-admin rule, so it must start
# from an instance with no web users. Dev databases only — never in prod.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Pin the dev DB explicitly — ambient DATABASE_URL (IDE shells, sandboxes)
# must never redirect this cleanup at some other database.
DB_URL="file:$ROOT/db/host-alfa.db"
bun -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: '$DB_URL' } } });
(async () => {
  await p.session.deleteMany({});
  await p.node.deleteMany({ where: { isDemo: false } });
  await p.user.deleteMany({});
  console.log('  ✓ tenant tables cleared');
  await p.\$disconnect();
})();"

echo "== 1) enter: first name becomes admin + auto node =="
R=$(curl -s -c $JA -X POST $B/api/auth/enter -H 'content-type: application/json' \
  -d '{"name":"ادمین نمونه"}')
echo "$R" | rg -o '"role":"admin"' >/dev/null && echo "  ✓ first entrant is admin" || { echo "  ✗ NOT admin: $R"; FAIL=$((FAIL+1)); }
echo "$R" | rg -o '"nodeCreated":true' >/dev/null && echo "  ✓ personal node auto-created" || { echo "  ✗ node not created: $R"; FAIL=$((FAIL+1)); }

echo "== 2) enter: second name is plain user =="
R=$(curl -s -c $JU -X POST $B/api/auth/enter -H 'content-type: application/json' \
  -d '{"name":"کاربر دوم"}')
echo "$R" | rg -o '"role":"user"' >/dev/null && echo "  ✓ second entrant is user" || { echo "  ✗ $R"; FAIL=$((FAIL+1)); }

echo "== 3) validation matrix =="
check "short name → 422" 422 $(code -X POST $B/api/auth/enter -H 'content-type: application/json' -d '{"name":"x"}')
R=$(curl -s -X POST $B/api/auth/enter -H 'content-type: application/json' -d '{"name":"ادمین نمونه"}')
echo "$R" | rg -o '"created":false' >/dev/null && echo "  ✓ re-entering same name logs in (created:false)" || { echo "  ✗ re-enter failed: $R"; FAIL=$((FAIL+1)); }

echo "== 4) id = name: node code IS the username =="
R=$(curl -s -b $JA $B/api/nh/bootstrap)
echo "$R" | rg -o '"code":"ادمین نمونه"' >/dev/null && echo "  ✓ admin node code = username" || { echo "  ✗ admin node code mismatch"; FAIL=$((FAIL+1)); }
R=$(curl -s -b $JU $B/api/nh/bootstrap)
echo "$R" | rg -o '"code":"کاربر دوم"' >/dev/null && echo "  ✓ user node code = username" || { echo "  ✗ user node code mismatch"; FAIL=$((FAIL+1)); }

echo "== 5) ownership matrix =="
NODE_ID=$(curl -s -b $JA $B/api/nh/bootstrap | rg -o '\{"id":"[^"]+","code":"ادمین نمونه"' | cut -d'"' -f4)
UNODE_ID=$(curl -s -b $JU $B/api/nh/bootstrap | rg -o '\{"id":"[^"]+","code":"کاربر دوم"' | cut -d'"' -f4)
check "user toggles ADMIN's node → 403" 403 $(code -b $JU -X POST $B/api/nh/nodes/$NODE_ID/modules -H 'content-type: application/json' -d '{"moduleId":"chat","enabled":false}')
check "user deletes ADMIN's node → 403" 403 $(code -b $JU -X DELETE $B/api/nh/nodes/$NODE_ID)
check "admin toggles USER's node → 200" 200 $(code -b $JA -X POST $B/api/nh/nodes/$UNODE_ID/modules -H 'content-type: application/json' -d '{"moduleId":"chat","enabled":true}')
check "user toggles OWN node → 200" 200 $(code -b $JU -X POST $B/api/nh/nodes/$UNODE_ID/modules -H 'content-type: application/json' -d '{"moduleId":"chat","enabled":true}')
check "guest toggle → 401" 401 $(code -X POST $B/api/nh/nodes/$UNODE_ID/modules -H 'content-type: application/json' -d '{"moduleId":"chat","enabled":true}')
check "second node per user → 403" 403 $(code -b $JU -X POST $B/api/nh/nodes -H 'content-type: application/json' -d '{}')

echo "== 6) bootstrap sanitization =="
GUEST_LOGS=$(curl -s $B/api/nh/bootstrap | rg -o '"logs":\[\{' | wc -l)
USER_TOKENS=$(curl -s -b $JU $B/api/nh/bootstrap | rg -o '"token":"nh_[^"]*"' | wc -l)
[ "$GUEST_LOGS" -eq 0 ] && echo "  ✓ guest sees NO logs" || { echo "  ✗ guest sees logs"; FAIL=$((FAIL+1)); }
[ "$USER_TOKENS" -ge 1 ] && echo "  ✓ user sees own token" || { echo "  ✗ user does not see own token"; FAIL=$((FAIL+1)); }

echo "== 7) federation management is admin-only =="
check "user adds host → 403" 403 $(code -b $JU -X POST $B/api/nh/hosts -H 'content-type: application/json' -d '{"name":"x","address":"http://x.example/ingress"}')
check "admin adds host → 200" 200 $(code -b $JA -X POST $B/api/nh/hosts -H 'content-type: application/json' -d '{"name":"میزبان تست","address":"http://127.0.0.1:4998/ingress"}')

echo "== 8) admin user management (suspend / activate) =="
USERS=$(curl -s -b $JA $B/api/admin/users)
SARA_ID=$(echo "$USERS" | rg -o '\{"id":"[^"]+","name":"کاربر دوم"' | cut -d'"' -f4)
check "user lists users → 403" 403 $(code -b $JU $B/api/admin/users)
check "admin suspends user → 200" 200 $(code -b $JA -X PATCH $B/api/admin/users/$SARA_ID -H 'content-type: application/json' -d '{"status":"suspended"}')
check "suspended name → 403" 403 $(code -X POST $B/api/auth/enter -H 'content-type: application/json' -d '{"name":"کاربر دوم"}')
M=$(curl -s -b $JU $B/api/auth/me); echo "$M" | rg -o '"user":null' >/dev/null && echo "  ✓ suspended session rejected (me → user:null)" || { echo "  ✗ suspended session still active: $M"; FAIL=$((FAIL+1)); }
curl -s -b $JA -X PATCH $B/api/admin/users/$SARA_ID -H 'content-type: application/json' -d '{"status":"active"}' >/dev/null
echo "  ✓ user re-activated"
curl -s -c $JU -X POST $B/api/auth/enter -H 'content-type: application/json' -d '{"name":"کاربر دوم"}' > /dev/null
R=$(curl -s -b $JU $B/api/auth/me); echo "$R" | rg -o '"role":"user"' >/dev/null && echo "  ✓ re-enter with same name → same account" || { echo "  ✗ re-enter failed: $R"; FAIL=$((FAIL+1)); }

echo "== 9) settings (maxNodes) — admin-only =="
check "user reads settings → 403" 403 $(code -b $JU $B/api/admin/settings)
check "admin sets maxNodes → 200" 200 $(code -b $JA -X PATCH $B/api/admin/settings -H 'content-type: application/json' -d '{"maxNodes":50}')

echo "== 10) logout =="
check "logout → 200" 200 $(code -b $JU -X POST $B/api/auth/logout)
check "after logout me → null" 200 $(code -b $JU $B/api/auth/me)
M=$(curl -s -b $JU $B/api/auth/me); echo "$M" | rg -o '"user":null' >/dev/null && echo "  ✓ session cleared" || { echo "  ✗ $M"; FAIL=$((FAIL+1)); }

echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ]
