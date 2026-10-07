import { createECDH, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { xmtpDir } from "./home.js";
import { evmAddressFromPubkey, toHex } from "./keccak.js";
import { signMessage } from "./priapi.js";
import { requireSession } from "./session.js";

const KEY_FILE = "identity.key"; // hex secp256k1 private key, 0o600
const AUTH_FILE = "authorization.json";

export function keyPath(): string {
  return join(xmtpDir(), KEY_FILE);
}

export function loadIdentityKey(): string | null {
  const p = keyPath();
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8").trim();
}

export function identityAddress(): string | null {
  const key = loadIdentityKey();
  if (!key) return null;
  const ecdh = createECDH("secp256k1");
  ecdh.setPrivateKey(Buffer.from(key.replace(/^0x/, ""), "hex"));
  const pub = ecdh.getPublicKey(null, "uncompressed");
  return evmAddressFromPubkey(pub);
}

/**
 * Provision the XMTP identity:
 *  1. generate a local secp256k1 key (the agentic wallet key never leaves TEE,
 *     so the XMTP identity is a dedicated local key — same as the reference
 *     design where okx-a2a carries XMTP_WALLET_KEY separately);
 *  2. have the wallet sign an authorization binding this XMTP address to the
 *     user's EVM address ("通过签名启动").
 */
export async function initIdentity(opts: { force?: boolean } = {}): Promise<{ address: string; fresh: boolean }> {
  requireSession();
  let key = loadIdentityKey();
  let fresh = false;
  if (!key || opts.force) {
    key = toHex(randomBytes(32));
    writeFileSync(keyPath(), key + "\n", { mode: 0o600 });
    fresh = true;
  }
  const address = identityAddress()!;

  const nonce = toHex(randomBytes(16));
  const statement = [
    "SnowAgent XMTP identity authorization",
    `address: ${address}`,
    `nonce: ${nonce}`,
  ].join("\n");

  const { signature } = await signMessage({ message: statement });
  writeFileSync(
    join(xmtpDir(), AUTH_FILE),
    JSON.stringify({ address, statement, signature, createdAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 }
  );
  return { address, fresh };
}

export function requireIdentityKey(): string {
  const key = loadIdentityKey();
  if (!key) throw new Error("no XMTP identity — run `snowagent xmtp init` first");
  return key;
}
