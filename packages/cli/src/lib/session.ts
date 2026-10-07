import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { sessionPath } from "./home.js";

export interface Session {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch seconds
  accountId?: string;
  accountName?: string;
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
