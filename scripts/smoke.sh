#!/usr/bin/env bash
# snowagent smoke test — no network calls, no login required.
set -euo pipefail

CLI="node /home/hatch/workspace/snowagent/packages/cli/dist/index.js"
A2A="node /home/hatch/workspace/snowagent/packages/a2a/dist/index.js"

echo "== cli --version =="
$CLI --version

echo "== wallet status (expect loggedIn:false) =="
$CLI wallet status --json | grep -q '"loggedIn": false' && echo OK

echo "== a2a --version =="
$A2A --version

echo "== a2a doctor (expect ready:false, no crash) =="
$A2A doctor --json | grep -q '"ready": false' && echo OK

echo "== user watch --once (expect empty items) =="
$A2A user watch --json --once | grep -q '"items": \[\]' && echo OK

echo "== outdated-list (expect empty) =="
$A2A user outdated-list --json | grep -q '"items": \[\]' && echo OK

echo "SMOKE OK"
