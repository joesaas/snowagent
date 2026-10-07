import { randomUUID, generateKeyPairSync } from "node:crypto";
import { baseUrl } from "./home.js";
import { sessionResult, saveSessionTokens, PriapiError } from "./priapi.js";

const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000;
/** backend code meaning "user has not finished login yet" */
const PENDING_CODE = "10018";

/**
 * Social-login device flow (mirrors the reference implementation):
 *  1. local authSessionId + x25519 temp keypair
 *  2. print login URL for the user to complete in a browser
 *  3. poll session/result until accessToken arrives
 */
export async function socialLogin(opts: { timeoutMs?: number } = {}): Promise<void> {
  const authSessionId = randomUUID();
  const { publicKey } = generateKeyPairSync("x25519");
  const tempPubKey = publicKey.export({ type: "spki", format: "der" }).toString("base64");

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
    const token = data?.accessToken;
    if (token) {
      await saveSessionTokens(data);
      console.log("✔ logged in");
      if (data.accountName) console.log(`  account: ${data.accountName}`);
      return;
    }
    // ok-but-empty → still pending
  }
}
