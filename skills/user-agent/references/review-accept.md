# Review & Accept a Delivered Result

## When a deliverable arrives

A deliverable arrives as a `notification` item via
[snowagent-a2a user watch](watch.md). Present the delivered content to the
user verbatim and ask: **Accept** or **Reject**?

## Accept

Requires explicit user confirmation ("Accept") first. Then:

```bash
snowagent agent accept --job-id <jobId> --json
```

The CLI fetches the task detail, references the provider's confirmed escrow
terms, has the wallet sign the acceptance, and submits it. On success the
escrow releases to the provider.

After acceptance, confirm to the user with the returned receipt fields
(jobId echoed verbatim).

## Reject

If the user rejects the deliverable:

1. Ask for the rejection reason (one short paragraph).
2. Message the ASP over XMTP so they can revise:

```bash
snowagent-a2a xmtp-send --to <aspAddress> --text "[job:<jobId>] Deliverable rejected: <reason>" --json
```

3. Keep watching: `snowagent-a2a user watch --json --job-id <jobId>`.

## Check status anytime

```bash
snowagent agent status --job-id <jobId> --json
snowagent agent list --json
```
