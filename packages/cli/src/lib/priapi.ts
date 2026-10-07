import { baseUrl } from "./home.js";
import { loadSession, saveSession, groupedAddresses } from "./session.js";
import { clientHeaders } from "./device.js";

export class PriapiError extends Error {
  code: string;
  constructor(code: string, msg: string) {
    super(`priapi error code=${code} msg=${msg}`);
    this.code = code;
  }
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  /** skip auth header (login polling) */
  noAuth?: boolean;
  /** extra headers merged over the client header set */
  extraHeaders?: Record<string, string>;
  _retried?: boolean;
}

/**
 * Minimal priapi HTTP client.
 *
 * Endpoint shapes below are derived from the reference implementation
 * (okx/onchainos-skills `cli/`). Field-level details should be re-verified
 * against live responses during integration — see DESIGN.md.
 */
export async function priapi<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const url = path.startsWith("http") ? path : baseUrl() + path;
  const headers: Record<string, string> = { ...clientHeaders(), ...(opts.extraHeaders ?? {}) };
  if (!opts.noAuth) {
    const s = loadSession();
    if (!s?.accessToken) throw new Error("not logged in — run `snowagent wallet login` first");
    headers["Authorization"] = `Bearer ${s.accessToken}`;
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e: any) {
    throw new Error(`network error calling ${path}: ${e.message}`);
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    throw new Error(`non-JSON response from ${path} (http ${res.status})`);
  }
  // OKX envelope: {code, msg, data}
  const code = String(json?.code ?? "");
  if (code === "10008" && !opts.noAuth && !(opts as any)._retried) {
    // access token expired → refresh once and retry
    await refreshAccessToken();
    return priapi<T>(path, { ...opts, _retried: true } as ApiOptions);
  }
  if (code !== "0" && code !== "00000") {
    throw new PriapiError(code || `http-${res.status}`, String(json?.msg ?? "unknown error"));
  }
  return (json.data ?? json) as T;
}

/** POST /priapi/v5/wallet/agentic/auth/refresh — rotates the access token. */
export async function refreshAccessToken(): Promise<void> {
  const s = loadSession();
  if (!s?.refreshToken) throw new Error("session expired — run `snowagent wallet login` again");
  const data: any = await priapi(`/priapi/v5/wallet/agentic/auth/refresh`, {
    method: "POST",
    body: { refreshToken: s.refreshToken },
    noAuth: true,
  });
  const item = Array.isArray(data) ? data[0] : data;
  if (!item?.accessToken) throw new Error("token refresh failed — run `snowagent wallet login` again");
  saveSession({
    ...s,
    accessToken: item.accessToken,
    refreshToken: item.refreshToken ?? s.refreshToken,
    expiresAt: item.sessionKeyExpireAt ?? item.expireAt ?? s.expiresAt,
  });
}

// ── session/result polling (login) ──────────────────────────────────────────
// POST /priapi/v5/wallet/agentic/auth/session/result  {authSessionId}
// → data is an array; data[0] is the VerifyResponse. code=10018 → pending.
export async function sessionResult(authSessionId: string): Promise<any> {
  const data: any = await priapi(`/priapi/v5/wallet/agentic/auth/session/result`, {
    method: "POST",
    body: { authSessionId },
    noAuth: true,
  });
  const arr = Array.isArray(data) ? data : data?.data;
  if (Array.isArray(arr) && arr.length > 0) return arr[0];
  return data;
}

// ── wallet ──────────────────────────────────────────────────────────────────
export async function walletAccounts(): Promise<any> {
  return priapi(`/priapi/v5/wallet/agentic/account/list`, { method: "POST", body: {} });
}

/** Addresses come from the local wallet store (populated at login), like the reference. */
export async function walletAddresses(): Promise<any> {
  const g = groupedAddresses();
  if (!g) throw new Error("no wallet data — run `snowagent wallet login` first");
  return g;
}

// ── agent commerce (user side) ──────────────────────────────────────────────
// aieco endpoints need: `agenticId` header (the USER's agent id) + sessionCert
// injected into the JSON body — mirrors the reference TaskApiClient.

/** The current account's user-role agent id (used as `agenticId`). */
export async function resolveUserAgentId(): Promise<string> {
  const { evmAddress } = await import("./session.js");
  const owner = evmAddress();
  if (!owner) throw new Error("no EVM address — run `snowagent wallet login` first");
  const q = new URLSearchParams({ chainIndex: "196", ownerAddress: owner, role: "1", pageSize: "100" });
  const data: any = await priapi(`/priapi/v5/wallet/agentic/agent/agent-list?${q}`);
  // response: [{list: [{accountName, agentList: [...]}]}]
  const outer = Array.isArray(data) ? data : [data];
  const agents: any[] = [];
  for (const g of outer) {
    for (const grp of g?.list ?? []) {
      for (const a of grp?.agentList ?? []) agents.push(a);
      if (grp?.agentId) agents.push(grp);
    }
    for (const a of g?.agentList ?? []) agents.push(a);
  }
  const user = agents.find((a: any) => Number(a.role) === 1) ?? agents[0];
  if (!user?.agentId) throw new Error("no user agent identity on this account");
  return String(user.agentId);
}

/** aieco POST with identity headers + sessionCert in body. */
export async function aieco<T = any>(path: string, body: Record<string, unknown>): Promise<T> {
  const s = loadSession();
  const agentId = await resolveUserAgentId();
  const withCert = { ...body };
  if (!withCert.sessionCert && s?.sessionCert) withCert.sessionCert = s.sessionCert;
  return priapi<T>(path, { body: withCert, extraHeaders: { agenticId: agentId } });
}
export interface CreateTaskInput {
  title: string;
  description: string;
  providerAgentId: string;
  serviceId: string;
  tokenSymbol: string;
  tokenAmount: string;
  chainId: string;
  serviceTokenAddress?: string;
  serviceTokenAmount?: string;
  serviceParams?: Record<string, unknown>;
  visibility?: string;
}

export async function createAndFundConfirmStatus(input: {
  providerAgentId: string;
  tokenSymbol: string;
  amount: string;
  chainId: string;
  serviceId: string;
}): Promise<any> {
  return aieco(`/priapi/v1/aieco/task/createAndFundConfirmStatus`, { ...input });
}

export async function createAndFund(body: Record<string, unknown>): Promise<any> {
  return aieco(`/priapi/v1/aieco/task/createAndFund`, body);
}

export async function myTasks(params: { page?: number; pageSize?: number; statusType?: number } = {}): Promise<any> {
  const agentId = await resolveUserAgentId();
  const q = new URLSearchParams({
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 20),
    statusType: String(params.statusType ?? 1),
  });
  return priapi(`/priapi/v1/aieco/task/my?${q}`, { extraHeaders: { agenticId: agentId } });
}

export async function taskDetail(jobId: string): Promise<any> {
  const agentId = await resolveUserAgentId();
  return priapi(`/priapi/v1/aieco/task/${encodeURIComponent(jobId)}/detail`, {
    extraHeaders: { agenticId: agentId },
  });
}

export async function providerConfirmStatus(jobId: string, q: Record<string, string>): Promise<any> {
  const agentId = await resolveUserAgentId();
  const qs = new URLSearchParams(q);
  return priapi(`/priapi/v1/aieco/task/${encodeURIComponent(jobId)}/providerConfirmStatus?${qs}`, {
    extraHeaders: { agenticId: agentId },
  });
}

/**
 * Communication readiness check. The reference implements this as a LOCAL
 * advisory check of the A2A runtime (not a priapi call): XMTP identity
 * present + daemon running.
 */
export async function communicationCheck(): Promise<any> {
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");
  const home = process.env.SNOWAGENT_HOME ?? join(homedir(), ".snowagent");
  const identityOk = existsSync(join(home, "xmtp", "identity.key"));
  let daemonPid: number | null = null;
  try {
    const pidFile = join(home, "a2a", "daemon.pid");
    if (existsSync(pidFile)) {
      const { readFileSync } = await import("node:fs");
      const pid = Number(readFileSync(pidFile, "utf8").trim());
      try {
        process.kill(pid, 0);
        daemonPid = pid;
      } catch { /* not running */ }
    }
  } catch { /* noop */ }
  const ok = identityOk && daemonPid !== null;
  return {
    ok,
    note: ok
      ? "communication ready"
      : "not ready — run `snowagent xmtp init` and `snowagent-a2a daemon start`",
    xmtpIdentity: identityOk,
    daemon: daemonPid !== null,
    daemonPid,
  };
}

export async function saveSessionTokens(data: any): Promise<void> {
  const s = loadSession() ?? { accessToken: "" };
  saveSession({
    ...s,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken ?? s.refreshToken,
    sessionCert: data.sessionCert ?? (s as any).sessionCert,
    sessionSeedB64: data.sessionSeedB64 ?? (s as any).sessionSeedB64,
    saTeeId: data.saTeeId ?? (s as any).saTeeId,
    expiresAt: data.expiresAt ?? data.expireAt,
    accountId: data.accountId ?? s.accountId,
    accountName: data.accountName ?? s.accountName,
  });
}
