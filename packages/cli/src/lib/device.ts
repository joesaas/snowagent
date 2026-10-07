import { createHash, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { hostname } from "node:os";
import { loadSession, saveSession } from "./session.js";

/**
 * Stable device identity for this client (independent from onchainos).
 * Derived as sha256(machine-id + "snowagent"), UUIDv4 fallback.
 * Persisted in session.json; sent as `device-id` header on every priapi call.
 */
const NAMESPACE = "snowagent";

function machineId(): string | null {
  for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      if (existsSync(p)) {
        const v = readFileSync(p, "utf8").trim();
        if (v) return v;
      }
    } catch { /* noop */ }
  }
  return null;
}

function isValid(id: string): boolean {
  return (id.length === 64 || id.length === 36) && /^[a-zA-Z0-9-]+$/.test(id);
}

export function deviceId(): string {
  const s = loadSession();
  const existing = (s as any)?.deviceId as string | undefined;
  if (existing && isValid(existing)) return existing;
  const mid = machineId();
  const id = mid
    ? createHash("sha256").update(mid + NAMESPACE, "utf8").digest("hex")
    : randomUUID();
  const cur = s ?? { accessToken: "" };
  saveSession({ ...cur, deviceId: id } as any);
  return id;
}

export function deviceName(): string {
  try {
    return hostname().slice(0, 64);
  } catch {
    return "snowagent";
  }
}

/** Header set mirroring the reference client (agent-cli). */
export function clientHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "ok-client-version": "0.1.0",
    "Ok-Access-Client-type": "agent-cli",
    platform: "agent-cli",
    "device-id": deviceId(),
    "device-name": deviceName(),
  };
}
