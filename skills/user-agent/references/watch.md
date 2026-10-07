# Watch Task Progress

## Start watching

```bash
snowagent-a2a user watch --json --job-id <jobId>
```

Without `--job-id`, watches the whole user inbox.

**Semantics — destructive read.** Each call first returns all unread items
accumulated since the last call, then long-polls for new ones (default
300s, `--timeout <secs>` to change, `--once` for a single drain without
waiting). Items returned are marked read and will never appear again.

**Anti-patterns:**

- Do NOT wrap watch in `/loop`, cron, `watch -n`, or sleep loops.
  The long-poll IS the wait.
- Do NOT pipe through `grep`/`jq`/etc. — the output is a single JSON
  document; pipes silently drop items.
- Do NOT pass `--from-now` equivalents or skip the backlog drain.

## Item envelope

```json
{
  "ok": true,
  "items": [
    {
      "id": "…",
      "kind": "notification",
      "jobId": "0x…",
      "userContent": "…",
      "from": "…",
      "sentAt": "…"
    }
  ]
}
```

- `kind == "notification"`: paste `userContent` to the user verbatim
  (as a blockquote), then re-enter watch.
- `kind == "decision_request"`: paste `userContent` verbatim and wait for
  the user's reply; on reply, run `snowagent-a2a user check --todo-ids <id>`
  to claim it, then follow the instructions in `llmContent`.

## Stop conditions

Stop re-entering watch only when:

- the user says `stop watching`;
- a scoped (`--job-id`) session receives a terminal marker
  (`[snowagent:task-terminal]` prefix or `[Job Completed]`-family heading)
  as the leading marker of a notification.

A global session never stops on one task's terminal state. Empty results
are not a stop — re-enter.

## Catching up

One-shot snapshot of unhandled items (no destructive read, no long-poll):

```bash
snowagent-a2a user outdated-list --json [--job-id <jobId>]
```

## Sending a message to the ASP

```bash
snowagent-a2a xmtp-send --to <aspAddress> --text "<message>" --json
```

Include `[job:<jobId>]` at the start of the text so the daemon can
attribute the thread to the task.
