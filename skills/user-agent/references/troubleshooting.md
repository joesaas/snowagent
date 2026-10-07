# Troubleshooting

## `snowagent` / `snowagent-a2a` not found

Re-run the installer from the repo root:

```bash
./install.sh
```

It links both binaries into `~/.local/bin`. Ensure `~/.local/bin` is on `PATH`.

## `not logged in`

```bash
snowagent wallet login
```

Complete the browser flow. Sessions expire — re-login when the CLI says so.

## `no XMTP identity`

```bash
snowagent xmtp init
```

Generates the local identity key and has the wallet sign the authorization.
`--force` rotates it (the old XMTP inbox becomes unreachable — only do this
deliberately).

## Daemon not running

```bash
snowagent-a2a daemon start
snowagent-a2a daemon status
```

Logs: `~/.snowagent/a2a/daemon.log`. If the daemon keeps dying, check the
log tail and run `snowagent-a2a doctor --json`.

## Readiness check

```bash
snowagent-a2a doctor --json
```

Checks: Node ≥ 22, XMTP identity present, daemon running, wallet logged in,
XMTP env. `ready: false` → fix the failing check.

## No task messages arriving

1. Daemon running? `snowagent-a2a daemon status`
2. Correct XMTP address given to the ASP? `snowagent xmtp address`
3. Check the log: `tail -50 ~/.snowagent/a2a/daemon.log`
4. As a fallback, poll task state directly:
   `snowagent agent status --job-id <jobId> --json`
