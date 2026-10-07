import { randomUUID, generateKeyPairSync } from "node:crypto";
import { baseUrl } from "./home.js";
import { sessionResult, saveSessionTokens, PriapiError } from "./priapi.js";
import { hpkeDecryptSessionSk } from "./hpke.js";
import { saveWallets } from "./session.js";

const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000;
/** backend code meaning "user has not finished login yet" */
const PENDING_CODE = "10018";

/** raw 32-byte X25519 key material from a KeyObject */
function exportRaw32(kind: "public" | "private", keyObj: any): Buffer {
  const der: Buffer =
    kind === "public"
      ? keyObj.export({ format: "der", type: "spki" })
      : keyObj.export({ format: "der", type: "pkcs8" });
  return Buffer.from(der.subarray(der.length - 32));
}

/**
 * Social-login device flow (mirrors the reference implementation):
 *  1. local authSessionId + x25519 keypair; tempPubKey = base64(raw 32B pubkey)
 *  2. print login URL for the user to complete in a browser
 *  3. poll session/result until the verify response arrives
 *  4. HPKE-decrypt the session signing seed, persist session + wallets
 */
export async function socialLogin(opts: { timeoutMs?: number } = {}): Promise<void> {
  const authSessionId = randomUUID();
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const tempPubKey = exportRaw32("public", publicKey).toString("base64");
  const sessionKeyB64 = exportRaw32("private", privateKey).toString("base64");

  const q = new URLSearchParams({
    authSessionId,
    tempPubKey,
    clientType: "agent-cli",
  });
  const loginUrl = `${baseUrl()}/account/sociallogin?${q}`;

  console.log("\nOpen this URL in your browser to log in:\n");
  console.log(`  ${loginUrl}\n`);
  console.log("Waiting for login (up to 5 minutes)...");

  const deadline = Date.now() + (opts.timeoutMs ?? TIMEOUT_MS);
  let transient = 0;
  for (;;) {
    if (Date.now() > deadline) throw new Error("login timed out — please try again");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    let data: any;
    try {
      data = await sessionResult(authSessionId);
      transient = 0;
    } catch (e: any) {
      if (e instanceof PriapiError && e.code === PENDING_CODE) continue; // not finished yet
      if (++transient >= 5) throw new Error(`login polling failed repeatedly: ${e.message}`);
      continue;
    }
    if (data?.accessToken) {
      await finalizeLogin(data, sessionKeyB64);
      console.log("✔ logged in");
      if (data.accountName) console.log(`  account: ${data.accountName}`);
      return;
    }
    // ok-but-empty → still pending
  }
}

async function finalizeLogin(verify: any, sessionKeyB64: string): Promise<void> {
  // HPKE-decrypt the Ed25519 session signing seed
  let sessionSeedB64: string | undefined;
  if (verify.encryptedSessionSk) {
    try {
      const seed = await hpkeDecryptSessionSk(verify.encryptedSessionSk, sessionKeyB64);
      sessionSeedB64 = seed.toString("base64");
    } catch (e: any) {
      console.error(`[snowagent] warning: failed to decrypt session seed: ${e.message}`);
    }
  }
  await saveSessionTokens({
    accessToken: verify.accessToken,
    refreshToken: verify.refreshToken,
    sessionCert: verify.sessionCert,
    sessionSeedB64,
    saTeeId: verify.saTeeId,
    expiresAt: verify.sessionKeyExpireAt ?? verify.expireAt,
    accountId: verify.accountId,
    accountName: verify.accountName,
  });
  // local wallet store (accounts + addresses), like the reference wallets.json
  const accounts = verify.allAccountAddressList?.length
    ? verify.allAccountAddressList
    : [
        {
          accountId: verify.accountId,
          accountName: verify.accountName,
          addresses: verify.addressList ?? [],
        },
      ];
  saveWallets({
    email: verify.loginInfo?.email ?? "",
    loginType: verify.loginInfo?.loginType ?? "",
    accounts: accounts.map((a: any) => ({
      accountId: a.accountId ?? a.account_id,
      accountName: a.accountName ?? a.account_name,
      isDefault: !!a.isDefault,
      addresses: (a.addresses ?? a.addressList ?? []).map((x: any) => ({
        address: x.address,
        chainIndex: String(x.chainIndex ?? x.chain_index ?? ""),
        chainName: x.chainName ?? x.chain_name ?? "",
        addressType: x.addressType ?? x.address_type ?? "",
      })),
    })),
  });
}
