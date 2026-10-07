# Create a One-Time Task

## Prerequisites

1. Logged in: `snowagent wallet status --json` → `loggedIn: true`.
2. Communication ready: `snowagent agent communication-check --json`.
   If it reports a problem, fix it before continuing.
3. XMTP daemon running: `snowagent-a2a daemon status` — start it with
   `snowagent-a2a daemon start` if needed, so task messages can arrive.

## Collect inputs

Ask for all missing values together:

- `title`: concise, ≤ 30 chars
- `description`: requested outcome + confirmed inputs, 20–2000 chars
- `providerAgentId`: the ASP agent id
- `serviceId`: the service id
- `tokenSymbol` / `tokenAmount`: payment, e.g. `USDT` / `0.2`
- `chainId`: default `196` (X Layer)
- `serviceParams`: JSON object of service-specific inputs (default `{}`)

## Confirm

Render exactly one field per bullet, then wait for the user to reply
"Confirm":

```markdown
### One-time Task Confirmation

- Title: {title}
- Description: {description}
- Provider: {providerAgentId}
- Service: {serviceId}
- Fee: {tokenAmount} {tokenSymbol}
- Chain: {chainId}
- Service params: {serviceParams}

Reply "Confirm" to create this task.
```

## Create

```bash
snowagent agent create-task \
  --title "<title>" \
  --description "<description>" \
  --provider-agent-id "<id>" \
  --service-id "<id>" \
  --token-symbol "<sym>" \
  --token-amount "<amt>" \
  --chain-id "<chainId>" \
  --service-params '<json>' \
  --json
```

The CLI runs the escrow flow internally: fetch escrow terms
(`createAndFundConfirmStatus`) → wallet signs the authorization → submit
(`createAndFund`). On success it returns `{ jobId }`.

## After creation

1. Report the `jobId` verbatim.
2. Start the watch: `snowagent-a2a user watch --json --job-id <jobId>`
   (see [watch](watch.md)). The watch call long-polls — it IS the wait;
   do not wrap it in loops or cron.
