#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { IdentifierKind } from "@xmtp/node-sdk";
import { createXmtpClient, xmtpEnv } from "./xmtp.js";
import { daemonRunning, drainUnread, listPending, markHandled } from "./store.js";
import { isDaemonMain, runDaemon, startDaemon, stopDaemon, readLog } from "./daemon.js";

if (isDaemonMain()) {
  runDaemon().catch((e) => {
    console.error(`[snowagent-a2a] daemon fatal: ${e?.message ?? e}`);
    process.exit(1);
  });
} else {
  main().catch((e) => {
    console.error(`[snowagent-a2a] error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}

function j(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

function sessionInfo(): { loggedIn: boolean; accountName?: string } {
  try {
    const p = process.env.SNOWAGENT_HOME
      ? join(process.env.SNOWAGENT_HOME, "session.json")
      : join(homedir(), ".snowagent", "session.json");
    if (!existsSync(p)) return { loggedIn: false };
    const s = JSON.parse(readFileSync(p, "utf8"));
    return { loggedIn: !!s.accessToken, accountName: s.accountName };
  } catch {
    return { loggedIn: false };
  }
}

async function main() {
  const program = new Command();
  program.name("snowagent-a2a").description("snowagent-a2a — XMTP-based A2A communication node").version("0.1.0");

  // ── daemon ──────────────────────────────────────────────────────────────
  const daemon = program.command("daemon").description("daemon lifecycle");
  daemon
    .command("start")
    .description("start the XMTP daemon (detached)")
    .action(() => startDaemon());
  daemon
    .command("stop")
    .description("stop the XMTP daemon")
    .action(() => stopDaemon());
  daemon
    .command("status")
    .description("daemon status")
    .option("--json", "json output")
    .action((opts) => {
      const pid = daemonRunning();
      const info = { running: pid !== null, pid, logTail: readLog(10) };
      if (opts.json) j(info);
      else console.log(pid ? `running (pid=${pid})` : "not running");
    });

  // ── xmtp-send ───────────────────────────────────────────────────────────
  program
    .command("xmtp-send")
    .description("send a text message over XMTP")
    .requiredOption("--to <address>", "recipient EVM address")
    .requiredOption("--text <msg>", "message text")
    .option("--json", "json output")
    .action(async (opts) => {
      const { client } = await createXmtpClient();
      const dm = await client.conversations.newDmWithIdentifier({
        identifier: opts.to.toLowerCase(),
        identifierKind: IdentifierKind.Ethereum,
      });
      const messageId = await dm.send(opts.text);
      j({ ok: true, messageId, to: opts.to });
    });

  // ── user ────────────────────────────────────────────────────────────────
  const user = program.command("user").description("user inbox commands");

  user
    .command("watch")
    .description("long-poll the inbox: drain unread first (destructive read), then wait for new events")
    .option("--json", "json output")
    .option("--job-id <id>", "scope to a job")
    .option("--timeout <secs>", "max wait seconds", "300")
    .option("--once", "single drain, no long-poll")
    .action(async (opts) => {
      const emit = (items: unknown[]) => {
        if (opts.json || true) j({ ok: true, items });
      };
      const first = drainUnread(opts.jobId);
      if (first.length || opts.once) {
        emit(first);
        return;
      }
      const deadline = Date.now() + Number(opts.timeout) * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const items = drainUnread(opts.jobId);
        if (items.length) {
          emit(items);
          return;
        }
      }
      emit([]);
    });

  user
    .command("outdated-list")
    .description("one-shot snapshot of unhandled inbox items (no destructive read)")
    .option("--json", "json output")
    .option("--job-id <id>", "scope to a job")
    .action((opts) => {
      j({ ok: true, items: listPending(opts.jobId) });
    });

  user
    .command("check")
    .description("mark inbox items as handled")
    .option("--todo-ids <ids>", "comma-separated item ids")
    .option("--json", "json output")
    .action((opts) => {
      const ids = String(opts.todoIds ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
      j({ ok: true, ...markHandled(ids) });
    });

  // ── doctor ──────────────────────────────────────────────────────────────
  program
    .command("doctor")
    .description("readiness check")
    .option("--json", "json output")
    .action(async (opts) => {
      const checks: Array<{ id: string; status: string; detail: string }> = [];
      const nodeOk = Number(process.versions.node.split(".")[0]) >= 22;
      checks.push({ id: "node_version", status: nodeOk ? "pass" : "fail", detail: process.version });
      let identity: string | null = null;
      try {
        const { loadIdentityKey } = await import("./xmtp.js");
        loadIdentityKey();
        const { privateKeyToAccount } = await import("viem/accounts");
        identity = privateKeyToAccount(loadIdentityKey() as `0x${string}`).address;
        checks.push({ id: "xmtp_identity", status: "pass", detail: identity });
      } catch (e: any) {
        checks.push({ id: "xmtp_identity", status: "fail", detail: e.message });
      }
      const pid = daemonRunning();
      checks.push({ id: "daemon", status: pid ? "pass" : "warn", detail: pid ? `running (pid=${pid})` : "not running" });
      const sess = sessionInfo();
      checks.push({ id: "wallet_login", status: sess.loggedIn ? "pass" : "warn", detail: sess.loggedIn ? `logged in${sess.accountName ? ` (${sess.accountName})` : ""}` : "not logged in" });
      checks.push({ id: "xmtp_env", status: "pass", detail: xmtpEnv() });
      const ready = checks.every((c) => c.status !== "fail");
      const result = { ok: true, ready, checks };
      if (opts.json || true) j(result);
    });

  await program.parseAsync(process.argv);
}
