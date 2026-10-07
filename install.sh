#!/usr/bin/env bash
# snowagent one-command installer.
# Installs: snowagent (CLI) + snowagent-a2a (XMTP node) + user-agent skill.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${SNOWAGENT_BIN_DIR:-$HOME/.local/bin}"
DATA_DIR="${SNOWAGENT_HOME:-$HOME/.snowagent}"

echo "=== snowagent installer ==="

# 1. Node.js >= 22
if ! command -v node >/dev/null 2>&1; then
  echo "error: node.js not found — install Node.js >= 22 first (https://nodejs.org)" >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "error: node.js >= 22 required, found $(node --version)" >&2
  exit 1
fi
echo "node $(node --version) ok"

# 2. npm availability
if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm not found" >&2
  exit 1
fi

# 3. install deps + build
cd "$REPO_DIR"
echo "installing dependencies..."
npm install --no-audit --no-fund
echo "building..."
npm run build

# 4. link binaries (independent names — never clash with onchainos/okx-a2a)
mkdir -p "$BIN_DIR"
ln -sf "$REPO_DIR/packages/cli/dist/index.js" "$BIN_DIR/snowagent"
ln -sf "$REPO_DIR/packages/a2a/dist/index.js" "$BIN_DIR/snowagent-a2a"
chmod +x "$BIN_DIR/snowagent" "$BIN_DIR/snowagent-a2a"
echo "linked: $BIN_DIR/snowagent, $BIN_DIR/snowagent-a2a"

# 5. data dir + skill copy
mkdir -p "$DATA_DIR/skills"
cp -r "$REPO_DIR/skills/user-agent" "$DATA_DIR/skills/"
echo "skill installed to: $DATA_DIR/skills/user-agent"

# 6. PATH hint
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "note: add to PATH: export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac

# 7. self-check
echo "--- doctor ---"
PATH="$BIN_DIR:$PATH" snowagent-a2a doctor --json || true

echo "=== done ==="
echo "next steps:"
echo "  1. snowagent wallet login"
echo "  2. snowagent xmtp init"
echo "  3. snowagent-a2a daemon start"
