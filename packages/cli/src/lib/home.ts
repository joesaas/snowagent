import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

/** Independent data home — never touches ~/.onchainos or ~/.okx-agent-task. */
export function snowHome(): string {
  const dir = process.env.SNOWAGENT_HOME ?? join(homedir(), ".snowagent");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function sessionPath(): string {
  return join(snowHome(), "session.json");
}

export function xmtpDir(): string {
  const dir = join(snowHome(), "xmtp");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function a2aDir(): string {
  const dir = join(snowHome(), "a2a");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function baseUrl(): string {
  return (process.env.SNOWAGENT_BASE_URL ?? "https://web3.okx.com").replace(/\/$/, "");
}
