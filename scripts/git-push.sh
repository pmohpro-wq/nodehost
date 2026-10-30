#!/usr/bin/env bash
# scripts/git-push.sh — secure push helper for pmohpro-wq/nodehost
# Reads token from .github-token (gitignored) and pushes main to origin.
# Never echoes the token. Use: bash scripts/git-push.sh ["commit message"]
set -euo pipefail

cd "$(dirname "$0")/.."

TOKEN_FILE=".github-token"
REPO="pmohpro-wq/nodehost"
BRANCH="main"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "ERROR: $TOKEN_FILE not found. Place a valid GitHub PAT in it (one line)." >&2
  exit 1
fi

TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: $TOKEN_FILE is empty." >&2
  exit 1
fi

# Stage & commit worklog if a message is provided
if [[ $# -ge 1 ]]; then
  git add -A
  git commit -m "$1" || echo "(nothing to commit)"
fi

# Push using token via env to avoid leaking in process listing or remote URL
GIT_ASKPASS="$(mktemp)"
cat > "$GIT_ASKPASS" <<EOF
#!/usr/bin/env bash
case "\$1" in
  Username*) echo "pmohpro-wq" ;;
  Password*) printf '%s' "$TOKEN" ;;
esac
EOF
chmod +x "$GIT_ASKPASS"
trap 'rm -f "$GIT_ASKPASS"' EXIT
export GIT_ASKPASS
# Disables any interactive prompt; ensures GIT_ASKPASS is used
export GIT_TERMINAL_PROMPT=0

REMOTE_URL="https://github.com/${REPO}.git"
echo "Pushing ${BRANCH} → ${REMOTE_URL} (token read from ${TOKEN_FILE}, never logged)"
if git push "$REMOTE_URL" "$BRANCH"; then
  echo "✓ Push OK"
else
  echo "✗ Push FAILED" >&2
  exit 1
fi
