import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import { keccak256 } from "./keccak.js";
import { priapi } from "./priapi.js";
import { requireSession, evmAddress } from "./session.js";

function addr(a: string): Buffer {
  const h = a.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(h)) throw new Error(`invalid address: ${a}`);
  return Buffer.concat([Buffer.alloc(12), Buffer.from(h, "hex")]);
}
function u256(v: string | number | bigint): Buffer {
  const b = BigInt(v);
  const hex = b.toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex");
}
function b32(a: string): Buffer {
  const h = a.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error(`invalid bytes32: ${a}`);
  return Buffer.from(h, "hex");
}

export interface EscrowFields {
  from: string;
  provider: string;
  receiver: string;
  arbitrator: string;
  currency: string;
  amount: string; // minimal units
  submitWindow: string | number;
  disputeWindow: string | number;
  arbitrationWindow: string | number;
  terminationWindow: string | number;
  hook: string;
  hookData: string; // 0x hex
  salt: string; // 0x bytes32
  chainId: string | number;
  escrowAddress: string;
}

/** keccak256(abi.encode(...)) — Solidity abi.encode for the fixed-size struct. */
export function escrowNonce(f: EscrowFields): string {
  const hookDataBytes = Buffer.from(f.hookData.replace(/^0x/, ""), "hex");
  const encoded = Buffer.concat([
    addr(f.from),
    addr(f.provider),
    addr(f.receiver),
    addr(f.arbitrator),
    addr(f.currency),
    u256(f.amount),
    u256(f.submitWindow),
    u256(f.disputeWindow),
    u256(f.arbitrationWindow),
    u256(f.terminationWindow),
    addr(f.hook),
    b32(Buffer.from(keccak256(hookDataBytes)).toString("hex")),
    b32(f.salt),
    u256(f.chainId),
    addr(f.escrowAddress),
  ]);
  return "0x" + Buffer.from(keccak256(encoded)).toString("hex");
}

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** base64(ed25519_sign(seed, msgHashBytes)) — raw hash, no eip191 wrapper. */
export function ed25519SignRaw(hashBytes: Buffer, seedB64: string): string {
  const seed = Buffer.from(seedB64, "base64");
  const key = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  return Buffer.from(cryptoSign(null, hashBytes, key)).toString("base64");
}

export interface EscrowAuth {
  signature: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/**
 * TEE-sign EIP-3009 ReceiveWithAuthorization for the escrow contract.
 * Mirrors the reference a2a_pay::sign_escrow.
 */
export async function signEscrow(f: EscrowFields, expiredAt: string): Promise<EscrowAuth> {
  const s = requireSession();
  if (!s.sessionCert || !s.sessionSeedB64) {
    throw new Error("session has no signing material — please `snowagent wallet login` again");
  }
  const from = evmAddress();
  if (!from) throw new Error("no EVM address — run `snowagent wallet login` first");

  const validAfter = "0";
  // expiredAt may be a unix timestamp ("1791370963") or RFC3339
  const validBefore = /^\d+$/.test(expiredAt.trim())
    ? expiredAt.trim()
    : String(Math.floor(new Date(expiredAt).getTime() / 1000));
  const nonce = escrowNonce({ ...f, from });

  // Step 1: gen-msg-hash
  const genBody = {
    chainIndex: String(f.chainId),
    from,
    to: f.escrowAddress,
    value: f.amount,
    validAfter,
    validBefore,
    nonce,
    verifyingContract: f.currency,
    signType: "eip3009ReceiveAuth",
    msgType: "eip3009ReceiveAuth",
  };
  const genResp: any = await priapi(`/priapi/v5/wallet/agentic/pre-transaction/gen-msg-hash`, {
    body: genBody,
  });
  const first = Array.isArray(genResp) ? genResp[0] : genResp;
  const msgHash: string = first?.msgHash;
  const domainHash: string = first?.domainHash;
  if (!msgHash || !domainHash) throw new Error("gen-msg-hash returned no msgHash/domainHash");

  // Step 2: sessionSignature over the raw hash
  const sessionSignature = ed25519SignRaw(
    Buffer.from(msgHash.replace(/^0x/, ""), "hex"),
    s.sessionSeedB64
  );

  // Step 3: sign-msg
  const signBody = {
    ...genBody,
    domainHash,
    sessionCert: s.sessionCert,
    sessionSignature,
  };
  const signResp: any = await priapi(`/priapi/v5/wallet/agentic/pre-transaction/sign-msg`, {
    body: signBody,
  });
  const sfirst = Array.isArray(signResp) ? signResp[0] : signResp;
  const signature: string = sfirst?.signature;
  if (!signature) throw new Error("sign-msg returned no signature");
  return { signature, validAfter, validBefore, nonce };
}
