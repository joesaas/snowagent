import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Client, type DecodedMessage, IdentifierKind } from "@xmtp/node-sdk";
import { privateKeyToAccount } from "viem/accounts";

function snowHome(): string {
  return process.env.SNOWAGENT_HOME ?? join(homedir(), ".snowagent");
}

export function identityKeyPath(): string {
  return join(snowHome(), "xmtp", "identity.key");
}

export function loadIdentityKey(): string {
  const p = identityKeyPath();
  if (!existsSync(p)) {
    throw new Error("no XMTP identity — run `snowagent xmtp init` first");
  }
  return readFileSync(p, "utf8").trim();
}

export function xmtpDbDir(): string {
  return join(snowHome(), "a2a", "xmtp-db");
}

export function xmtpEnv(): string {
  return process.env.SNOWAGENT_XMTP_ENV ?? "production";
}

/**
 * Build an EOA signer from the local identity key and create the XMTP client.
 * The identity key itself was authorized by a wallet signature at
 * `snowagent xmtp init` time (see packages/cli) — "通过签名启动".
 */
export async function createXmtpClient() {
  const key = loadIdentityKey() as `0x${string}`;
  const account = privateKeyToAccount(key);
  const signer = {
    type: "EOA" as const,
    getIdentifier: () => ({
      identifier: account.address.toLowerCase(),
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage: async (message: string) => {
      const sig = await account.signMessage({ message });
      const hex = sig.replace(/^0x/, "");
      return Uint8Array.from(Buffer.from(hex, "hex"));
    },
  };
  const client = await Client.create(signer, {
    env: xmtpEnv() as any,
    dbPath: join(xmtpDbDir(), "xmtp.db3"),
  });
  return { client, address: account.address };
}

export interface InboxItem {
  id: string;
  kind: "notification" | "decision_request";
  jobId?: string;
  userContent: string;
  llmContent?: string;
  from: string;
  conversationId: string;
  sentAt: string;
  read: boolean;
}

/** Extract a jobId marker from message text, e.g. `[job:0xabc...]`. */
export function parseJobId(text: string): string | undefined {
  const m = text.match(/\[job:([^\]]+)\]/);
  return m?.[1];
}

export function messageToItem(msg: DecodedMessage, selfInboxId: string): InboxItem | null {
  if (msg.senderInboxId === selfInboxId) return null; // skip own messages
  const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
  return {
    id: String(msg.id),
    kind: "notification",
    jobId: parseJobId(content),
    userContent: content,
    from: msg.senderInboxId,
    conversationId: String((msg as any).conversationId ?? ""),
    sentAt: new Date(Number((msg as any).sentAtNs ?? 0n) / 1e6).toISOString(),
    read: false,
  };
}
