/**
 * Minimal keccak-256 (Ethereum variant) — vendored to avoid a dependency
 * for a single hash. Standard Keccak-f[1600] with 0x01 domain suffix.
 */
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const RHO = [
  [0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56], [27, 20, 39, 8, 14],
];
const MASK = (1n << 64n) - 1n;

function rotl(x: bigint, n: number): bigint {
  n %= 64;
  return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK;
}

function keccakF(s: bigint[]): void {
  for (let r = 0; r < 24; r++) {
    // Theta
    const c = [0n, 0n, 0n, 0n, 0n];
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) c[x] ^= s[x + 5 * y];
    const d = [0n, 0n, 0n, 0n, 0n];
    for (let x = 0; x < 5; x++)
      d[x] = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) s[x + 5 * y] ^= d[x];
    // Rho + Pi
    const b = new Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], RHO[x][y]);
    // Chi
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        s[x + 5 * y] = b[x + 5 * y] ^ ((~b[(x + 1) % 5 + 5 * y] & MASK) & b[(x + 2) % 5 + 5 * y]);
    // Iota
    s[0] ^= RC[r];
  }
}

export function keccak256(data: Uint8Array): Uint8Array {
  const rate = 136; // 1088 bits for keccak-256
  const s = new Array<bigint>(25).fill(0n);
  const padded = new Uint8Array(Math.ceil((data.length + 1) / rate) * rate);
  padded.set(data);
  padded[data.length] = 0x01;
  padded[padded.length - 1] |= 0x80;
  const view = new DataView(padded.buffer);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      s[i] ^= view.getBigUint64(off + i * 8, true);
    }
    keccakF(s);
  }
  const out = new Uint8Array(32);
  const oview = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) oview.setBigUint64(i * 8, s[i], true);
  return out;
}

/** EVM address from an uncompressed secp256k1 public key (0x04 || X || Y). */
export function evmAddressFromPubkey(uncompressedPubkey: Uint8Array): string {
  const hash = keccak256(uncompressedPubkey.slice(1));
  return "0x" + Buffer.from(hash.slice(12)).toString("hex");
}

export function toHex(b: Uint8Array): string {
  return "0x" + Buffer.from(b).toString("hex");
}
