import { CipherSuite, KemId, KdfId, AeadId } from "hpke-js";

/**
 * HPKE-decrypt `encrypted_session_sk` using the local X25519 session key.
 *
 * Suite (from the reference implementation):
 *   DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM
 *   info = b"okx-tee-sign"
 * Wire: enc(32 bytes) || ciphertext.
 *
 * Returns the 32-byte Ed25519 signing seed.
 */
const INFO = new TextEncoder().encode("okx-tee-sign");

export async function hpkeDecryptSessionSk(encryptedB64: string, sessionKeyB64: string): Promise<Buffer> {
  const encrypted = Buffer.from(encryptedB64, "base64");
  const sk = Buffer.from(sessionKeyB64, "base64");
  if (sk.length !== 32) throw new Error(`session_key must be 32 bytes, got ${sk.length}`);
  if (encrypted.length <= 32) throw new Error(`encrypted_session_sk too short: ${encrypted.length}`);

  const suite = new CipherSuite({
    kem: KemId.DhkemX25519HkdfSha256,
    kdf: KdfId.HkdfSha256,
    aead: AeadId.Aes256Gcm,
  });
  const enc = encrypted.subarray(0, 32);
  const ciphertext = encrypted.subarray(32);
  const skBytes = sk.buffer.slice(sk.byteOffset, sk.byteOffset + sk.byteLength);
  const recipientKey = await suite.kem.importKey("raw", skBytes);
  const recipient = await suite.createRecipientContext({
    recipientKey,
    info: INFO,
    enc,
  });
  const pt = await recipient.open(ciphertext);
  const seed = Buffer.from(pt);
  if (seed.length !== 32) throw new Error(`decrypted signing seed must be 32 bytes, got ${seed.length}`);
  return seed;
}

// self-test against the reference known vector
if (process.argv[1]?.endsWith("hpke.js")) {
  const enc = "D77ghrSZD4FhOjt8h6irNQS9OBxaq7Ry6LobgKyBuV4rPLTulIoZSsEt5pZYptfSFo8AX+XwIYw8RRJXPNRhRSJDno4F0CLdPNFeat16/90=";
  const privHex = "7e0e4cb4ce949dcee0ca600713d37a0ecec71e3f20b7a834680ba2306e06c671";
  const skB64 = Buffer.from(privHex, "hex").toString("base64");
  const seed = await hpkeDecryptSessionSk(enc, skB64);
  const expected = "d84197bf9417d10a74cfba304f487868bb41708623e1d61823df44c734cda122";
  if (seed.toString("hex") !== expected) {
    console.error(`HPKE vector MISMATCH: got ${seed.toString("hex")}`);
    process.exit(1);
  }
  console.log("HPKE known-vector OK");
}
