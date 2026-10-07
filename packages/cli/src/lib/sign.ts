import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import { keccak256 } from "./keccak.js";
import { requireSession } from "./session.js";

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/**
 * sessionSignature for sign-msg: base64( Ed25519_sign( seed,
 *   keccak256( "\x19Ethereum Signed Message:\n" + len + message ) ) )
 * Mirrors the reference `ed25519_sign_eip191`.
 */
export function sessionSignature(message: string, seedB64: string): string {
  const data = Buffer.from(message, "utf8");
  const prefix = Buffer.from(`\x19Ethereum Signed Message:\n${data.length}`, "utf8");
  const hash = keccak256(Buffer.concat([prefix, data]));
  const seed = Buffer.from(seedB64, "base64");
  const key = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const sig = cryptoSign(null, Buffer.from(hash), key);
  return Buffer.from(sig).toString("base64");
}

function base58Encode(bytes: Buffer): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) zeroes++;
  let num = 0n;
  for (let i = zeroes; i < bytes.length; i++) num = num * 256n + BigInt(bytes[i]);
  let out = "";
  while (num > 0n) {
    out = ALPHABET[Number(num % 58n)] + out;
    num /= 58n;
  }
  return "1".repeat(zeroes) + out;
}

function encodeMessageValue(message: string, chainIndex: string): string {
  if (chainIndex === "501") return base58Encode(Buffer.from(message, "utf8")); // Solana
  return message; // raw for EVM
}

export interface SignMsgResult {
  signature: string;
  raw: any;
}

import { priapi } from "./priapi.js";

/**
 * TEE personalSign via sign-msg.
 * Body mirrors the reference: {chainIndex, from, sessionCert, payload:[{signType, message:{value}, sessionSignature}]}.
 */
export async function signMessage(params: {
  message: string;
  chainIndex?: string;
  from?: string;
}): Promise<SignMsgResult> {
  const s = requireSession();
  if (!s.sessionCert || !s.sessionSeedB64) {
    throw new Error("session has no signing material — please `snowagent wallet login` again");
  }
  const chainIndex = params.chainIndex ?? "1";
  const { evmAddress } = await import("./session.js");
  const from = params.from ?? evmAddress() ?? "";
  const sig = sessionSignature(params.message, s.sessionSeedB64);
  const body: Record<string, unknown> = {
    chainIndex,
    from,
    sessionCert: s.sessionCert,
    payload: [
      {
        signType: "personalSign",
        message: { value: encodeMessageValue(params.message, chainIndex) },
        sessionSignature: sig,
      },
    ],
  };
  const raw = await priapi(`/priapi/v5/wallet/agentic/pre-transaction/sign-msg`, { body });
  const signature: string =
    (raw as any)?.signature ?? (raw as any)?.signatures?.[0] ?? (raw as any)?.data?.signature ?? "";
  return { signature, raw };
}
