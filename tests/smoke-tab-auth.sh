#!/bin/bash
# smoke-tab-auth.sh — proves the TAB-ISOLATED identity era end-to-end.
#
# Contract under test:
#   1. /api/auth/enter is the one door (passwordless, id = name) — idempotent.
#   2. Every /api/nh + /api/admin call resolves the viewer from the
#      `x-nh-user` header (URL-encoded name) — NO cookies, NO server sessions.
#   3. Two headers on the same URLs = two independent viewers (tab isolation).
#   4. A tab without a header is a guest (sanitized view, no user nodes).
#   5. Ownership gates still hold: user A cannot touch user B's node/mailbox.
#   6. Chat (module app API) works across two users of the same host.
#
# Usage: bash tests/smoke-tab-auth.sh   (kernel :3013 + web :3000 must be up)

set -u
WEB="http://127.0.0.1:3000"
KERNEL="http://127.0.0.1:3013"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ✓ $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  ✗ $1"; }
enc()  { python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$1"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$2"; }

TS=$(date +%s)
U1="sara$TS"           # NEW ids are English-only lowercase+digits (identity law — no '_')
U2="basam$TS"
LEGACY="میلی"          # legacy holder: Persian login must keep working + header URL-encoding
H1="x-nh-user: $(enc "$U1")"
H2="x-nh-user: $(enc "$U2")"

echo "== health =="
curl -sf -m 3 "$KERNEL/internal/bootstrap" >/dev/null && ok "kernel :3013 up" || bad "kernel down"
curl -sf -m 3 "$WEB/api/nh/bootstrap" >/dev/null && ok "web :3000 up" || bad "web down"

echo "== enter: the one door (passwordless, id=name) =="
R=$(curl -s -m 5 -X POST "$WEB/api/auth/enter" -H 'content-type: application/json' -d "{\"name\":\"$U1\"}")
[ "$(echo "$R" | json -c "d['ok']")" = "True" ] && ok "enter $U1 → ok" || bad "enter $U1 failed: $R"
[ "$(echo "$R" | json -c "d['created']")" = "True" ] && ok "first enter → account+node created" || bad "expected created:true: $R"
[ "$(echo "$R" | json -c "d['user']['name']")" = "$U1" ] && ok "user.name == node code == input" || bad "id≠name: $R"

R=$(curl -s -m 5 -X POST "$WEB/api/auth/enter" -H 'content-type: application/json' -d "{\"name\":\"$U1\"}")
[ "$(echo "$R" | json -c "d['created']")" = "False" ] && ok "second enter → plain login (idempotent)" || bad "expected created:false: $R"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X POST "$WEB/api/auth/enter" -H 'content-type: application/json' -d '{"name":"a|b"}')
[ "$CODE" = "422" ] && ok "name with '|' rejected (422)" || bad "expected 422 for a|b, got $CODE"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X POST "$WEB/api/auth/enter" -H 'content-type: application/json' -d "{\"name\":\"فارسی_$TS\"}")
[ "$CODE" = "422" ] && ok "new Persian id rejected — English law (422)" || bad "expected 422 for Persian new id, got $CODE"

R=$(curl -s -m 5 -X POST "$WEB/api/auth/enter" -H 'content-type: application/json' -d "{\"name\":\"$LEGACY\"}")
[ "$(echo "$R" | json -c "d['ok']")" = "True" ] && ok "legacy Persian login works (exact match)" || bad "legacy login failed: $R"

HL="x-nh-user: $(enc "$LEGACY")"
BL=$(curl -s -m 5 "$WEB/api/nh/bootstrap" -H "$HL")
[ "$(echo "$BL" | json -c "d['viewer']['name']")" = "$LEGACY" ] && ok "URL-encoded Persian header → viewer" || bad "legacy viewer mismatch: $BL"

U2R=$(curl -s -m 5 -X POST "$WEB/api/auth/enter" -H 'content-type: application/json' -d "{\"name\":\"$U2\"}")
[ "$(echo "$U2R" | json -c "d['ok']")" = "True" ] && ok "enter $U2 → ok" || bad "enter $U2 failed: $U2R"

echo "== bootstrap: same URL, different headers = different viewers =="
B1=$(curl -s -m 5 "$WEB/api/nh/bootstrap" -H "$H1")
[ "$(echo "$B1" | json -c "d['viewer']['name']")" = "$U1" ] && ok "header $U1 → viewer $U1" || bad "viewer mismatch: $B1"
N1=$(echo "$B1" | json -c "[n['id'] for n in d['nodes'] if n['code']=='$U1'][0]")
[ -n "$N1" ] && ok "own node visible (id=$N1)" || bad "own node missing: $B1"
[ "$(echo "$B1" | json -c "any(n['ownerName']=='$U1' for n in d['nodes'])")" = "True" ] && ok "ownerName stamped" || bad "ownerName missing"

B2=$(curl -s -m 5 "$WEB/api/nh/bootstrap" -H "$H2")
N2=$(echo "$B2" | json -c "[n['id'] for n in d['nodes'] if n['code']=='$U2'][0]")
[ "$(echo "$B2" | json -c "d['viewer']['name']")" = "$U2" ] && ok "header $U2 → viewer $U2 (same URLs, other tab)" || bad "viewer2 mismatch: $B2"

BG=$(curl -s -m 5 "$WEB/api/nh/bootstrap")
[ "$(echo "$BG" | json -c "d['viewer']")" = "None" ] && ok "no header → guest (viewer null)" || bad "guest viewer not null: $BG"
[ "$(echo "$BG" | json -c "any(n.get('token') for n in d['nodes'])")" = "False" ] && ok "guest sees no user tokens" || bad "guest leak: $BG"

BX=$(curl -s -m 5 "$WEB/api/nh/bootstrap" -H "x-nh-user: ghost_who_never_was_$TS")
[ "$(echo "$BX" | json -c "d['viewer']")" = "None" ] && ok "unknown header name → guest (no trust)" || bad "ghost viewer: $BX"

echo "== chat: two tab-identities talking through the kernel =="
curl -s -m 5 -X POST "$WEB/api/nh/nodes/$N1/modules" -H "$H1" -H 'content-type: application/json' -d '{"moduleId":"chat","enabled":true}' >/dev/null
curl -s -m 5 -X POST "$WEB/api/nh/nodes/$N2/modules" -H "$H2" -H 'content-type: application/json' -d '{"moduleId":"chat","enabled":true}' >/dev/null
S=$(curl -s -m 5 -X POST "$WEB/api/nh/nodes/$N1/apps/chat/send" -H "$H1" -H 'content-type: application/json' -d "{\"to\":{\"host\":\"alfa\",\"node\":\"$U2\"},\"text\":\"سلام از تب $U1\"}")
[ "$(echo "$S" | json -c "d['ok']")" = "True" ] && ok "send $U1 → $U2 ok" || bad "send failed: $S"
sleep 1
C2=$(curl -s -m 5 "$WEB/api/nh/nodes/$N2/apps/chat/conversations" -H "$H2")
[ "$(echo "$C2" | json -c "any(c['peer']['node']=='$U1' for c in d['conversations'])")" = "True" ] && ok "$U2 sees the conversation" || bad "no conversation: $C2"
[ "$(echo "$C2" | json -c "sum(c['unread'] for c in d['conversations'])")" -ge 1 ] && ok "unread counted" || bad "unread=0: $C2"

echo "== isolation gates still hold =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$WEB/api/nh/mailbox/$U2" -H "$H1")
[ "$CODE" = "403" ] && ok "$U1 cannot read $U2's mailbox (403)" || bad "expected 403, got $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$WEB/api/nh/nodes/$N2/apps/chat/conversations" -H "$H1")
[ "$CODE" = "403" ] && ok "$U1 cannot open $U2's chat app (403)" || bad "expected 403, got $CODE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X POST "$WEB/api/nh/nodes/$N2/modules" -H "$H1" -H 'content-type: application/json' -d '{"moduleId":"chat","enabled":false}')
[ "$CODE" = "403" ] && ok "$U1 cannot toggle $U2's modules (403)" || bad "expected 403, got $CODE"

echo
echo "RESULT: pass=$PASS fail=$FAIL"
[ "$FAIL" = "0" ]
