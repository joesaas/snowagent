import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { InboxItem } from "./xmtp.js";

function a2aDir(): string {
  const d = process.env.SNOWAGENT_HOME
    ? join(process.env.SNOWAGENT_HOME, "a2a")
    : join(homedir(), ".snowagent", "a2a");
  mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

export function inboxPath(): string {
  return join(a2aDir(), "inbox.jsonl");
}

export function pidPath(): string {
  return join(a2aDir(), "daemon.pid");
}

export function logPath(): string {
  return join(a2aDir(), "daemon.log");
}

/** Append an item to the local inbox (daemon writes, CLI reads). */
export function appendItem(item: InboxItem): void {
  appendFileSync(inboxPath(), JSON.stringify(item) + "\n", { mode: 0o600 });
}

function readAll(): InboxItem[] {
  const p = inboxPath();
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as InboxItem;
      } catch {
        return null;
      }
    })
    .filter((x): x is InboxItem => !!x);
}

function writeAll(items: InboxItem[]): void {
  writeFileSync(inboxPath(), items.map((i) => JSON.stringify(i)).join("\n") + (items.length ? "\n" : ""), {
    mode: 0o600,
  });
}

/**
 * Destructive read: return unread items and mark them read.
 * Mirrors `okx-a2a user watch` semantics — consumed items never reappear.
 */
export function drainUnread(jobId?: string): InboxItem[] {
  const items = readAll();
  const picked = items.filter((i) => !i.read && (!jobId || i.jobId === jobId));
  if (!picked.length) return [];
  const ids = new Set(picked.map((i) => i.id));
  writeAll(items.map((i) => (ids.has(i.id) ? { ...i, read: true } : i)));
  return picked;
}

/** One-shot snapshot of unhandled items (outdated-list). No destructive read. */
export function listPending(jobId?: string): InboxItem[] {
  return readAll().filter((i) => !i.read && (!jobId || i.jobId === jobId));
}

/** Mark todo ids as handled (user check). */
export function markHandled(ids: string[]): { handled: string[]; alreadyHandled: string[] } {
  const items = readAll();
  const handled: string[] = [];
  const alreadyHandled: string[] = [];
  const next = items.map((i) => {
    if (ids.includes(i.id)) {
      if (i.read) alreadyHandled.push(i.id);
      else {
        handled.push(i.id);
        return { ...i, read: true };
      }
    }
    return i;
  });
  writeAll(next);
  return { handled, alreadyHandled };
}

export function daemonRunning(): number | null {
  const p = pidPath();
  if (!existsSync(p)) return null;
  const pid = Number(readFileSync(p, "utf8").trim());
  if (!pid) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}
