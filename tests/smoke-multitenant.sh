#!/bin/bash
# Multi-tenant auth matrix smoke test (runs against the running dev server).
set -e
B="http://127.0.0.1:3000"
JA=/tmp/nh-admin.jar; JU=/tmp/nh-user.jar; J2=/tmp/nh-user2.jar
rm -f $JA $JU $J2
PASS=0; FAIL=0
check() { # name expected_code actual_code
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✓ $1 [$3]"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — expected $2 got $3"; fi
}
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

echo "== 1) register: first user becomes admin =="
R=$(curl -s -c $JA -X POST $B/api/auth/register -H 'content-type: application/json' \
  -d '{"name":"ادمین نمونه","email":"admin@test.local","password":"pass-1234"}')
echo "$R" | rg -o '"role":"admin"' >/dev/null && echo "  ✓ first registrant is admin" || { echo "  ✗ NOT admin: $R"; FAIL=$((FAIL+1)); }

echo "== 2) register: second user is plain user =="
R=$(curl -s -c $JU -X POST $B/api/auth/register -H 'content-type: application/json' \
  -d '{"name":"کاربر دوم","email":"sara@test.local","password":"pass-1234"}')
echo "$R" | rg -o '"role":"user"' >/dev/null && echo "  ✓ second registrant is user" || { echo "  ✗ $R"; FAIL=$((FAIL+1)); }

echo "== 3) validation matrix =="
check "register dup email → 409" 409 $(code -X POST $B/api/auth/register -H 'content-type: application/json' -d '{"name":"x y","email":"admin@test.local","password":"pass-1234"}')
check "register short pw → 422" 422 $(code -X POST $B/api/auth/register -H 'content-type: application/json' -d '{"name":"x y","email":"new@test.local","password":"short"}')
check "login wrong pw → 401" 401 $(code -X POST $B/api/auth/login -H 'content-type: application/json' -d '{"email":"admin@test.local","password":"wrong-pass"}')

echo "== 4) admin creates a node =="
R=$(curl -s -b $JA -X POST $B/api/nh/nodes -H 'content-type: application/json' -d '{"name":"نود ادمین"}')
NODE_ID=$(echo "$R" | rg -o '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
NODE_CODE=$(echo "$R" | rg -o '"code":"[^"]+"' | head -1 | cut -d'"' -f4)
[ -n "$NODE_ID" ] && echo "  ✓ node created $NODE_CODE" || { echo "  ✗ $R"; FAIL=$((FAIL+1)); }

echo "== 5) user creates own node =="
R=$(curl -s -b $JU -X POST $B/api/nh/nodes -H 'content-type: application/json' -d '{"name":"نود سارا"}')
UNODE_ID=$(echo "$R" | rg -o '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
[ -n "$UNODE_ID" ] && echo "  ✓ user node created" || { echo "  ✗ $R"; FAIL=$((FAIL+1)); }

echo "== 6) ownership matrix =="
check "user toggles ADMIN's node → 403" 403 $(code -b $JU -X POST $B/api/nh/nodes/$NODE_ID/modules -H 'content-type: application/json' -d '{"moduleId":"chat","enabled":false}')
check "user deletes ADMIN's node → 403" 403 $(code -b $JU -X DELETE $B/api/nh/nodes/$NODE_ID)
check "admin toggles USER's node → 200" 200 $(code -b $JA -X POST $B/api/nh/nodes/$UNODE_ID/modules -H 'content-type: application/json' -d '{"moduleId":"chat","enabled":true}')
check "user toggles OWN node → 200" 200 $(code -b $JU -X POST $B/api/nh/nodes/$UNODE_ID/modules -H 'content-type: application/json' -d '{"moduleId":"ping","enabled":false}')
check "guest toggle → 401" 401 $(code -X POST $B/api/nh/nodes/$UNODE_ID/modules -H 'content-type: application/json' -d '{"moduleId":"chat","enabled":true}')

echo "== 7) bootstrap sanitization =="
GUEST_NODES=$(curl -s $B/api/nh/bootstrap | rg -o '"ownerName":"[^"]*"' | wc -l)
USER_TOKENS=$(curl -s -b $JU $B/api/nh/bootstrap | rg -o '"token":"nh_[^"]*"' | wc -l)
USER_SEES_OWN=$(curl -s -b $JU $B/api/nh/bootstrap | rg -c "نود سارا" || true)
echo "$USER_SEES_OWN" | rg -q '^0$' && { echo "  ✗ user does NOT see own node"; FAIL=$((FAIL+1)); } || echo "  ✓ user sees own node (+demo)"
ADMIN_LOGS=$(curl -s -b $JA $B/api/nh/bootstrap | rg -o '"logs":\[\{' | wc -l)
GUEST_LOGS=$(curl -s $B/api/nh/bootstrap | rg -o '"logs":\[\{' | wc -l)
[ "$ADMIN_LOGS" -ge 1 ] && echo "  ✓ admin sees kernel logs" || { echo "  ✗ admin logs empty"; FAIL=$((FAIL+1)); }
[ "$GUEST_LOGS" -eq 0 ] && echo "  ✓ guest sees NO logs" || { echo "  ✗ guest sees logs"; FAIL=$((FAIL+1)); }

echo "== 8) federation management is admin-only =="
check "user adds host → 403" 403 $(code -b $JU -X POST $B/api/nh/hosts -H 'content-type: application/json' -d '{"name":"x","address":"http://x.example/ingress"}')
check "admin adds host → 200" 200 $(code -b $JA -X POST $B/api/nh/hosts -H 'content-type: application/json' -d '{"name":"میزبان تست","address":"http://127.0.0.1:4998/ingress"}')

echo "== 9) admin user management =="
USERS=$(curl -s -b $JA $B/api/admin/users)
SARA_ID=$(echo "$USERS" | rg -o '\{"id":"[^"]+","email":"sara@test.local"' | cut -d'"' -f4)
check "user lists users → 403" 403 $(code -b $JU $B/api/admin/users)
check "admin suspends sara → 200" 200 $(code -b $JA -X PATCH $B/api/admin/users/$SARA_ID -H 'content-type: application/json' -d '{"status":"suspended"}')
check "suspended login → 403" 403 $(code -X POST $B/api/auth/login -H 'content-type: application/json' -d '{"email":"sara@test.local","password":"pass-1234"}')
M=$(curl -s -b $JU $B/api/auth/me); echo "$M" | rg -o '"user":null' >/dev/null && echo "  ✓ suspended session rejected (me → user:null)" || { echo "  ✗ suspended session still active: $M"; FAIL=$((FAIL+1)); }
curl -s -b $JA -X PATCH $B/api/admin/users/$SARA_ID -H 'content-type: application/json' -d '{"status":"active"}' >/dev/null
echo "  ✓ sara re-activated"
curl -s -c $JU -X POST $B/api/auth/login -H 'content-type: application/json' -d '{"email":"sara@test.local","password":"pass-1234"}' > /dev/null
R=$(curl -s -b $JU $B/api/auth/me); echo "$R" | rg -o '"role":"user"' >/dev/null && echo "  ✓ sara re-login OK" || { echo "  ✗ sara re-login failed: $R"; FAIL=$((FAIL+1)); }

echo "== 10) settings (maxNodes) =="
check "user reads settings → 403" 403 $(code -b $JU $B/api/admin/settings)
check "admin sets maxNodes=2 → 200" 200 $(code -b $JA -X PATCH $B/api/admin/settings -H 'content-type: application/json' -d '{"maxNodes":2}')
curl -s -c $J2 -X POST $B/api/auth/register -H 'content-type: application/json' -d '{"name":"کاربر سوم","email":"reza@test.local","password":"pass-1234"}' >/dev/null
check "3rd node over quota → 403" 403 $(code -b $J2 -X POST $B/api/nh/nodes -H 'content-type: application/json' -d '{"name":"نود رضا"}')
check "admin resets maxNodes=50 → 200" 200 $(code -b $JA -X PATCH $B/api/admin/settings -H 'content-type: application/json' -d '{"maxNodes":50}')
check "node create after reset → 200" 200 $(code -b $J2 -X POST $B/api/nh/nodes -H 'content-type: application/json' -d '{"name":"نود رضا"}')

echo "== 11) logout =="
check "logout → 200" 200 $(code -b $J2 -X POST $B/api/auth/logout)
check "after logout me → null" 200 $(code -b $J2 $B/api/auth/me)
M=$(curl -s -b $J2 $B/api/auth/me); echo "$M" | rg -o '"user":null' >/dev/null && echo "  ✓ session cleared" || { echo "  ✗ $M"; FAIL=$((FAIL+1)); }

echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ]
