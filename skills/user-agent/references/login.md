# Wallet Login

## Check status first

```bash
snowagent wallet status --json
```

`loggedIn: true` → skip the rest.

## Login (device flow)

```bash
snowagent wallet login
```

The command prints a URL. Tell the user to open it in a browser and complete
the social login there. The command polls the backend (2s interval, 5-minute
timeout) and stores the JWT session in `~/.snowagent/session.json` (mode 600).

On timeout: re-run the command for a fresh URL — do not reuse an expired one.

## Addresses

```bash
snowagent wallet addresses --json
```

Echo the address **verbatim** from the output. The EVM address is shared
across EVM chains; Solana / Sui / Bitcoin each have their own.

## Sign a message

```bash
snowagent wallet sign --message "<text>" --json
```

The key never leaves the backend TEE — signing happens server-side against
the logged-in session. Use this for XMTP identity authorization and any
user-approved message signing.

## Logout

```bash
snowagent wallet logout
```

Clears the local session only. The XMTP identity key is kept (run
`snowagent xmtp init --force` to rotate it).
