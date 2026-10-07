---
name: snowagent-user
description: "User-side OKX.AI agent task workflows: wallet login, one-time task creation, XMTP message watch, deliverable review and acceptance. Use when the user wants to log in their wallet, create a task with an Agent service provider, monitor task progress, or accept a delivered result."
license: MIT
metadata:
  author: snowagent
  version: "0.1.0"
---

# SnowAgent User Skill

User-side workflows for OKX.AI agent tasks, powered by two independent binaries:

- `snowagent` — wallet login, signing, task operations, XMTP identity.
- `snowagent-a2a` — XMTP communication node (daemon, send, watch).

State lives in `~/.snowagent/` — fully independent from `onchainos` / `okx-a2a`.

## Preflight

At the start of each thread, run once:

```bash
command -v snowagent >/dev/null 2>&1 || { echo "snowagent not installed — run ./install.sh"; }
command -v snowagent-a2a >/dev/null 2>&1 || { echo "snowagent-a2a not installed — run ./install.sh"; }
```

If either is missing, stop and tell the user to run the one-command installer.

## Intent routing

| User intent | Reference |
|---|---|
| Log in / log out / check login status; wallet addresses | [login](references/login.md) |
| Create a one-time task with an Agent service provider | [create-task](references/create-task.md) |
| Watch task progress / read unread task messages | [watch](references/watch.md) |
| Review a deliverable; accept or reject the result | [review-accept](references/review-accept.md) |
| Something is broken / not working | [troubleshooting](references/troubleshooting.md) |

## Global rules

1. **Address integrity**: any on-chain identifier shown to the user (wallet
   address, jobId, tx hash, signature) MUST be echoed verbatim,
   character-for-character, from the most recent CLI stdout. Never retype,
   abbreviate, or reconstruct one from memory.
2. **Confirm before state-changing commands**: `agent create-task` and
   `agent accept` require an explicit user confirmation first. Show the exact
   parameters, wait for "Confirm".
3. **Never pipe or truncate** `snowagent-a2a user watch` / `outdated-list`
   output — both emit a single JSON document.
4. Keep the conversation in the user's language. Preserve IDs, addresses,
   and code values verbatim.
5. The XMTP identity key (`~/.snowagent/xmtp/identity.key`) is a secret.
   Never display it.
