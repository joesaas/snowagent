import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createXmtpClient, messageToItem } from "./xmtp.js";
import { appendItem, daemonRunning, pidPath, logPath } from "./store.js";

const DAEMON_ARG = "--snowagent-a2a-daemon";

function log(line: string): void {
  appendFileSync(logPath(), `[${new Date().toISOString()}] ${line}\n`);
}

/** The long-lived process body: XMTP client + message pump → inbox.jsonl */
export async function runDaemon(): Promise<void> {
  log("daemon starting");
  const { client, address } = await createXmtpClient();
  log(`xmtp client ready: ${address} inbox=${client.inboxId}`);

  // 1. backfill recent conversations
  try {
    await client.conversations.sync();
    const convos = await client.conversations.list();
    for (const c of convos) {
      await c.sync();
      const msgs = await c.messages({ limit: 50 });
      for (const m of msgs) {
        const item = messageToItem(m as any, client.inboxId);
        if (item) appendItem(item);
      }
    }
    log(`backfilled ${convos.length} conversations`);
  } catch (e: any) {
    log(`backfill error: ${e.message}`);
  }

  // 2. live stream
  const stream = await client.conversations.streamAllMessages(async (err, msg) => {
    if (err || !msg) {
      if (err) log(`stream error: ${String(err)}`);
      return;
    }
    const item = messageToItem(msg as any, client.inboxId);
    if (item) {
      appendItem(item);
      log(`new message from ${item.from} convo=${item.conversationId}`);
    }
  }, undefined, undefined, () => {
    log("stream failed — exiting for supervisor restart");
    process.exit(1);
  });

  const shutdown = async () => {
    log("daemon shutting down");
    try {
      await stream.return(undefined);
    } catch { /* noop */ }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // heartbeat: keep the event loop alive and refresh periodically
  setInterval(async () => {
    try {
      await client.conversations.sync();
    } catch (e: any) {
      log(`periodic sync error: ${e.message}`);
    }
  }, 60_000).unref();
  log("daemon running");
}

export function startDaemon(): void {
  const pid = daemonRunning();
  if (pid) {
    console.log(JSON.stringify({ ok: true, alreadyRunning: true, pid }));
    return;
  }
  const self = process.argv[1];
  const child = spawn(process.execPath, [self, DAEMON_ARG], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  writeFileSync(pidPath(), String(child.pid), { mode: 0o600 });
  console.log(JSON.stringify({ ok: true, started: true, pid: child.pid }));
}

export function stopDaemon(): void {
  const pid = daemonRunning();
  if (!pid) {
    console.log(JSON.stringify({ ok: true, stopped: false, reason: "not running" }));
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch { /* already gone */ }
  if (existsSync(pidPath())) unlinkSync(pidPath());
  console.log(JSON.stringify({ ok: true, stopped: true, pid }));
}

export function isDaemonMain(): boolean {
  return process.argv.includes(DAEMON_ARG);
}

export function readLog(tail = 30): string {
  if (!existsSync(logPath())) return "";
  const lines = readFileSync(logPath(), "utf8").trim().split("\n");
  return lines.slice(-tail).join("\n");
}
