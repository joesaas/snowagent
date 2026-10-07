import { aieco } from "./priapi.js";
import { requireSession, evmAddress } from "./session.js";
import { sessionSignatureBytes, ed25519SignRawBytes } from "./sign.js";

function decodeByEncoding(msg: string, encoding: string): Buffer {
  if (!msg) return Buffer.alloc(0);
  if (encoding === "hex") return Buffer.from(msg.replace(/^0x/, ""), "hex");
  if (encoding === "base64") return Buffer.from(msg, "base64");
  throw new Error(`unsupported encoding: ${encoding}`);
}

/**
 * Sign the uopData transaction payload and broadcast the task.
 * Mirrors the reference sign_uop_and_broadcast_full + build_broadcast_body.
 */
export async function broadcastTask(jobId: string, uopData: any, bizType: number): Promise<any> {
  const s = requireSession();
  if (!s.sessionSeedB64 || !s.sessionCert) {
    throw new Error("session has no signing material — please `snowagent wallet login` again");
  }
  if (!uopData) throw new Error("backend did not return uopData; cannot sign and broadcast");
  if (uopData.executeResult === false) {
    throw new Error(`backend transaction preflight failed: ${uopData.executeErrorMsg || "no detail"}`);
  }
  const seedB64 = s.sessionSeedB64;
  const encoding: string = uopData.encoding ?? "";

  // msgForSign — mirrors sign_and_build_extra_data
  const mfs: Record<string, string> = {};
  if (uopData.hash) {
    mfs.signature = sessionSignatureBytes(decodeByEncoding(uopData.hash, "hex"), seedB64);
  }
  if (uopData.unsignedTxHash) {
    mfs.unsignedTxHash = uopData.unsignedTxHash;
    mfs.sessionSignature = ed25519SignRawBytes(decodeByEncoding(uopData.unsignedTxHash, encoding), seedB64);
  }
  if (uopData.unsignedTx) {
    mfs.unsignedTx = uopData.unsignedTx;
  }
  mfs.sessionCert = s.sessionCert;

  const extraBase =
    uopData.extraData && typeof uopData.extraData === "object" ? { ...uopData.extraData } : {};
  const extraData = {
    ...extraBase,
    checkBalance: true,
    uopHash: uopData.uopHash ?? "",
    encoding,
    signType: uopData.signType ?? "",
    msgForSign: mfs,
  };

  const address = evmAddress();
  if (!address) throw new Error("no EVM address — run `snowagent wallet login` first");
  const body = {
    accountId: s.accountId ?? "",
    address,
    chainIndex: "196",
    extraData: JSON.stringify(extraData),
    bizContext: { jobId, bizType },
  };
  const resp: any = await aieco(`/priapi/v1/aieco/task/broadcast`, body);
  return Array.isArray(resp) ? resp[0] : resp;
}
