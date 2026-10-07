#!/usr/bin/env node
import { Command } from "commander";
import { socialLogin } from "./lib/login.js";
import { clearSession, loadSession } from "./lib/session.js";
import { walletAccounts, walletAddresses, communicationCheck } from "./lib/priapi.js";
import { signMessage } from "./lib/sign.js";
import { acceptTask, createTask, listTasks, taskStatus } from "./lib/task.js";
import { identityAddress, initIdentity } from "./lib/xmtp-key.js";

const program = new Command();
program.name("snowagent").description("snowagent — user-side OKX.AI agent task toolkit").version("0.1.0");

function out(data: unknown, json: boolean) {
  if (json) console.log(JSON.stringify(data, null, 2));
  else if (typeof data === "object") console.log(JSON.stringify(data, null, 2));
  else console.log(String(data));
}

function fail(e: unknown): never {
  console.error(`[snowagent] error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

// ── wallet ──────────────────────────────────────────────────────────────────
const wallet = program.command("wallet").description("wallet login, addresses, signing");

wallet
  .command("login")
  .description("social login (device flow) — opens a browser URL, polls until done")
  .action(async () => {
    try {
      await socialLogin();
    } catch (e) {
      fail(e);
    }
  });

wallet
  .command("logout")
  .description("clear local session")
  .action(() => {
    clearSession();
    console.log("logged out");
  });

wallet
  .command("status")
  .description("show login status")
  .option("--json", "json output")
  .action((opts) => {
    const s = loadSession();
    out({ loggedIn: !!s?.accessToken, accountName: s?.accountName, accountId: s?.accountId }, opts.json);
  });

wallet
  .command("accounts")
  .description("list wallet accounts")
  .option("--json", "json output")
  .action(async (opts) => {
    try {
      out(await walletAccounts(), opts.json);
    } catch (e) {
      fail(e);
    }
  });

wallet
  .command("addresses")
  .description("list wallet addresses (verbatim from backend)")
  .option("--json", "json output")
  .action(async (opts) => {
    try {
      out(await walletAddresses(), opts.json);
    } catch (e) {
      fail(e);
    }
  });

wallet
  .command("sign")
  .description("sign a message with the TEE-hosted wallet (personalSign)")
  .requiredOption("--message <text>", "message to sign")
  .option("--json", "json output")
  .action(async (opts) => {
    try {
      const r = await signMessage({ message: opts.message });
      out(r, opts.json);
    } catch (e) {
      fail(e);
    }
  });

// ── agent (user side) ───────────────────────────────────────────────────────
const agent = program.command("agent").description("one-time task operations (user side)");

agent
  .command("communication-check")
  .description("check A2A communication readiness")
  .option("--json", "json output")
  .action(async (opts) => {
    try {
      out(await communicationCheck(), opts.json);
    } catch (e) {
      fail(e);
    }
  });

agent
  .command("create-task")
  .description("create and fund a one-time task")
  .requiredOption("--title <t>", "job title (<=30 chars)")
  .requiredOption("--description <d>", "job description (20-2000 chars)")
  .requiredOption("--provider-agent-id <id>", "ASP agent id")
  .requiredOption("--service-id <id>", "service id")
  .requiredOption("--token-symbol <s>", "payment token symbol")
  .requiredOption("--token-amount <a>", "payment token amount")
  .option("--chain-id <id>", "chain id", "196")
  .option("--service-params <json>", "service params JSON", "{}")
  .option("--service-token-address <addr>", "service token contract")
  .option("--service-token-amount <a>", "service token amount")
  .option("--visibility <v>", "visibility", "public")
  .option("--json", "json output")
  .action(async (opts) => {
    try {
      let serviceParams = {};
      try {
        serviceParams = JSON.parse(opts.serviceParams);
      } catch {
        fail("invalid --service-params JSON");
      }
      const r = await createTask({
        title: opts.title,
        description: opts.description,
        providerAgentId: opts.providerAgentId,
        serviceId: opts.serviceId,
        tokenSymbol: opts.tokenSymbol,
        tokenAmount: opts.tokenAmount,
        chainId: opts.chainId,
        serviceParams,
        serviceTokenAddress: opts.serviceTokenAddress,
        serviceTokenAmount: opts.serviceTokenAmount,
        visibility: opts.visibility,
      });
      out(r, opts.json);
    } catch (e) {
      fail(e);
    }
  });

agent
  .command("status")
  .description("query task status")
  .requiredOption("--job-id <id>", "job id")
  .option("--json", "json output")
  .action(async (opts) => {
    try {
      out(await taskStatus(opts.jobId), opts.json);
    } catch (e) {
      fail(e);
    }
  });

agent
  .command("list")
  .description("list my tasks")
  .option("--status-type <n>", "status type", "1")
  .option("--json", "json output")
  .action(async (opts) => {
    try {
      out(await listTasks(Number(opts.statusType)), opts.json);
    } catch (e) {
      fail(e);
    }
  });

agent
  .command("accept")
  .description("accept the delivered result of a task")
  .requiredOption("--job-id <id>", "job id")
  .option("--json", "json output")
  .action(async (opts) => {
    try {
      out(await acceptTask(opts.jobId), opts.json);
    } catch (e) {
      fail(e);
    }
  });

// ── xmtp identity ───────────────────────────────────────────────────────────
const xmtp = program.command("xmtp").description("XMTP identity management");

xmtp
  .command("init")
  .description("provision XMTP identity key + wallet-signed authorization")
  .option("--force", "regenerate even if one exists")
  .option("--json", "json output")
  .action(async (opts) => {
    try {
      const r = await initIdentity({ force: !!opts.force });
      out(r, opts.json);
    } catch (e) {
      fail(e);
    }
  });

xmtp
  .command("address")
  .description("show the XMTP identity address")
  .action(() => {
    const a = identityAddress();
    if (!a) fail("no XMTP identity — run `snowagent xmtp init` first");
    console.log(a);
  });

program.parseAsync(process.argv).catch(fail);
