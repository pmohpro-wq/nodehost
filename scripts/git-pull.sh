#!/usr/bin/env bash
# scripts/git-pull.sh — secure pull helper for pmohpro-wq/nodehost
# Reads token from .github-token (gitignored) and pulls origin/main into main.
# Never echoes the token. Use: bash scripts/git-pull.sh
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
export GIT_TERMINAL_PROMPT=0

REMOTE_URL="https://github.com/${REPO}.git"
echo "Fetching ${BRANCH} ← ${REMOTE_URL} (token read from ${TOKEN_FILE}, never logged)"
# Fetch by remote NAME (not URL) so refs/remotes/origin/* stay fresh —
# fetching a URL only updates FETCH_HEAD and leaves origin/main stale.
git fetch --prune origin "$BRANCH"

echo "--- incoming commits (origin/${BRANCH} not in local HEAD):"
if git log --oneline --no-decorate "HEAD..origin/${BRANCH}" | head -30; then
  :
fi
INCOMING="$(git rev-list --count "HEAD..origin/${BRANCH}")"
echo "--- incoming count: ${INCOMING}"

if [[ "$INCOMING" -eq 0 ]]; then
  echo "✓ Already up to date — nothing to pull."
  exit 0
fi

echo "--- files changed:"
git diff --stat "HEAD...origin/${BRANCH}" | tail -25

echo "--- rebasing local work onto origin/${BRANCH} (autostash for runtime files)…"
git pull --rebase --autostash "$REMOTE_URL" "$BRANCH"

echo "--- final state:"
git log --oneline --no-decorate -5
echo "✓ Pull OK"
