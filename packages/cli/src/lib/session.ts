import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sessionPath, snowHome } from "./home.js";

export interface Session {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  accountId?: string;
  accountName?: string;
  /** backend-issued session certificate, required by sign-msg */
  sessionCert?: string;
  /** base64 Ed25519 seed (HPKE-decrypted); signs sessionSignature for sign-msg */
  sessionSeedB64?: string;
  saTeeId?: string;
}

export function loadSession(): Session | null {
  const p = sessionPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Session;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  writeFileSync(sessionPath(), JSON.stringify(s, null, 2), { mode: 0o600 });
}

export function requireSession(): Session {
  const s = loadSession();
  if (!s?.accessToken) {
    throw new Error("not logged in — run `snowagent wallet login` first");
  }
  return s;
}

export function clearSession(): void {
  saveSession({ accessToken: "" });
}

// ── local wallet store (accounts + addresses), mirrors reference wallets.json ──

export interface WalletAddress {
  address: string;
  chainIndex: string;
  chainName: string;
  addressType?: string;
}

export interface WalletAccount {
  accountId: string;
  accountName: string;
  isDefault?: boolean;
  addresses: WalletAddress[];
}

export interface Wallets {
  email?: string;
  loginType?: string;
  accounts: WalletAccount[];
}

function walletsPath(): string {
  return join(snowHome(), "wallets.json");
}

export function loadWallets(): Wallets | null {
  const p = walletsPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Wallets;
  } catch {
    return null;
  }
}

export function saveWallets(w: Wallets): void {
  writeFileSync(walletsPath(), JSON.stringify(w, null, 2), { mode: 0o600 });
}

/** Active account = default flag, else first. */
export function activeAccount(): WalletAccount | null {
  const w = loadWallets();
  if (!w?.accounts?.length) return null;
  return w.accounts.find((a) => a.isDefault) ?? w.accounts[0];
}

/** Group addresses the way `wallet addresses` renders them. */
export function groupedAddresses(): {
  accountId: string;
  accountName: string;
  bitcoin: object[];
  evm: object[];
  solana: object[];
  sui: object[];
  xlayer: object[];
} | null {
  const a = activeAccount();
  if (!a) return null;
  const item = (x: WalletAddress) => ({
    address: x.address,
    chainIndex: x.chainIndex,
    chainName: x.chainName,
  });
  const out = {
    accountId: a.accountId,
    accountName: a.accountName,
    bitcoin: [] as object[],
    evm: [] as object[],
    solana: [] as object[],
    sui: [] as object[],
    xlayer: [] as object[],
  };
  for (const x of a.addresses) {
    switch (x.chainIndex) {
      case "0": out.bitcoin.push(item(x)); break;
      case "784": out.sui.push(item(x)); break;
      case "196": out.xlayer.push(item(x)); break;
      case "501": out.solana.push(item(x)); break;
      default: out.evm.push(item(x));
    }
  }
  return out;
}

/** First EVM address of the active account (used as `from` for signing). */
export function evmAddress(): string | null {
  const g = groupedAddresses();
  const first: any = g?.evm[0];
  return first?.address ?? null;
}
