#!/bin/bash
# Smoke test — contacts module (kernel control plane, localhost-trusted)
# Covers: registry, enable, add (valid/self/invalid/duplicate), list presence,
#         update (pin/note/alias), remove, and cap-rejection error shape.
set -e
K="http://127.0.0.1:3013/internal"
PASS=0; FAIL=0
ck() { # ck <label> <expected> <actual>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1 (expected=$2 actual=$3)"; fi
}
jqf() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }

# 1) module registered in bootstrap
MODS=$(curl -s $K/bootstrap | jqf "['modules']")
ck "contacts registered in moduleDef" "True" "$(echo "$MODS" | grep -q contacts && echo True || echo False)"

# 2) pick/create a node to test on
NODE_CODE="smoke-contacts-$$"
NODE=$(curl -s -X POST $K/nodes -H 'content-type: application/json' -d "{\"code\":\"$NODE_CODE\",\"name\":\"$NODE_CODE\"}")
NID=$(echo "$NODE" | jqf "['node']['id']")
ck "node created" "True" "$([ -n "$NID" ] && [ "$NID" != "None" ] && echo True || echo False)"

# 3) enable contacts + chat on it
R=$(curl -s -X POST $K/nodes/$NID/modules -H 'content-type: application/json' -d '{"moduleId":"contacts","enabled":true}')
ck "enable contacts" "True" "$(echo "$R" | grep -q '"ok":true' && echo True || echo False)"
R=$(curl -s -X POST $K/nodes/$NID/modules -H 'content-type: application/json' -d '{"moduleId":"chat","enabled":true}')
ck "enable chat" "True" "$(echo "$R" | grep -q '"ok":true' && echo True || echo False)"
sleep 1 # runtime reconciliation

A="$K/nodes/$NID/apps/contacts"

# 4) self-add rejected
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST $A/add -H 'content-type: application/json' -d "{\"host\":\"alfa\",\"node\":\"$NODE_CODE\"}")
ck "self-add rejected 422" "422" "$CODE"

# 5) invalid address rejected (pipe char)
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST $A/add -H 'content-type: application/json' -d '{"host":"al|fa","node":"sara"}')
ck "invalid addr rejected 422" "422" "$CODE"

# 6) valid add — local peer
R=$(curl -s -X POST $A/add -H 'content-type: application/json' -d '{"host":"alfa","node":"sara","name":"سارا"}')
ck "add sara ok" "True" "$(echo "$R" | grep -q '"alreadyExisted":false' && echo True || echo False)"

# 7) duplicate add = idempotent upsert
R=$(curl -s -X POST $A/add -H 'content-type: application/json' -d '{"host":"alfa","node":"sara"}')
ck "duplicate add idempotent" "True" "$(echo "$R" | grep -q '"alreadyExisted":true' && echo True || echo False)"

# 8) add a peer on an UNKNOWN host (phone-book model — zero validation against directory)
R=$(curl -s -X POST $A/add -H 'content-type: application/json' -d '{"host":"faraway","node":"rezа","note":"منتظر اتصال سرورش"}')
ck "add on unknown host ok" "True" "$(echo "$R" | grep -q '"ok":true' && echo True || echo False)"

# 9) list + presence enrichment
L=$(curl -s "$A/list")
TOTAL=$(echo "$L" | jqf "['total']")
ck "list total=2" "2" "$TOTAL"
PRES_FAR=$(echo "$L" | python3 -c "import sys,json;d=json.load(sys.stdin);c=[x for x in d['contacts'] if x['host']=='faraway'][0];print(c['presence']['known'],c['presence']['online'])")
ck "unknown host presence known=False" "False False" "$PRES_FAR"

# 10) update: pin + alias + note on sara
R=$(curl -s -X POST $A/update -H 'content-type: application/json' -d '{"host":"alfa","node":"sara","pinned":true,"note":"همکار تیم"}')
ck "update pinned" "True" "$(echo "$R" | grep -q '"pinned":true' && echo True || echo False)"
FIRST=$(echo "$L" >/dev/null; curl -s "$A/list" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['contacts'][0]['node'])")
ck "pinned sorts first" "sara" "$FIRST"

# 11) remove
R=$(curl -s -X POST $A/remove -H 'content-type: application/json' -d '{"host":"faraway","node":"rezа"}')
ck "remove ok" "True" "$(echo "$R" | grep -q '"ok":true' && echo True || echo False)"
TOTAL=$(curl -s "$A/list" | jqf "['total']")
ck "list total=1 after remove" "1" "$TOTAL"

# 12) update of nonexistent contact → 404
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST $A/update -H 'content-type: application/json' -d '{"host":"x","node":"y","pinned":true}')
ck "update missing 404" "404" "$CODE"

# 13) disabled module → 409 (runtime has no live instance)
curl -s -X POST $K/nodes/$NID/modules -H 'content-type: application/json' -d '{"moduleId":"contacts","enabled":false}' > /dev/null
sleep 1
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$A/list")
ck "disabled module 409" "409" "$CODE"

# cleanup: delete the smoke node
curl -s -X DELETE $K/nodes/$NID > /dev/null
echo "-----------------------------------"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
