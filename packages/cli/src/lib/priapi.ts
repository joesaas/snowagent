import { baseUrl } from "./home.js";
import { loadSession, saveSession } from "./session.js";

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
  const headers: Record<string, string> = { "Content-Type": "application/json" };
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
  if (code !== "0" && code !== "00000") {
    throw new PriapiError(code || `http-${res.status}`, String(json?.msg ?? "unknown error"));
  }
  return (json.data ?? json) as T;
}

// ── session/result polling (login) ──────────────────────────────────────────
export async function sessionResult(authSessionId: string): Promise<any> {
  return priapi(`/priapi/v5/wallet/agentic/session/result?authSessionId=${encodeURIComponent(authSessionId)}`, {
    noAuth: true,
  });
}

// ── wallet ──────────────────────────────────────────────────────────────────
export async function walletAccounts(): Promise<any> {
  return priapi(`/priapi/v5/wallet/agentic/account/list`);
}

export async function walletAddresses(): Promise<any> {
  return priapi(`/priapi/v5/wallet/agentic/account/addresses`);
}

/** TEE personalSign of an arbitrary message. */
export async function signMessage(params: {
  accountId?: string;
  message: string;
  chainIndex?: string;
}): Promise<{ signature: string }> {
  return priapi(`/priapi/v5/wallet/agentic/pre-transaction/sign-msg`, {
    body: {
      accountId: params.accountId,
      message: params.message,
      chainIndex: params.chainIndex ?? "1",
      signType: "personalSign",
    },
  });
}

// ── agent commerce (user side) ──────────────────────────────────────────────
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
  return priapi(`/priapi/v1/aieco/task/createAndFundConfirmStatus`, { body: input });
}

export async function createAndFund(body: Record<string, unknown>): Promise<any> {
  return priapi(`/priapi/v1/aieco/task/createAndFund`, { body });
}

export async function myTasks(params: { page?: number; pageSize?: number; statusType?: number } = {}): Promise<any> {
  const q = new URLSearchParams({
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 20),
    statusType: String(params.statusType ?? 1),
  });
  return priapi(`/priapi/v1/aieco/task/my?${q}`);
}

export async function taskDetail(jobId: string): Promise<any> {
  return priapi(`/priapi/v1/aieco/task/${encodeURIComponent(jobId)}/detail`);
}

export async function providerConfirmStatus(jobId: string, q: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(q);
  return priapi(`/priapi/v1/aieco/task/${encodeURIComponent(jobId)}/providerConfirmStatus?${qs}`);
}

/** Communication readiness check (mirrors `onchainos agent communication-check`). */
export async function communicationCheck(): Promise<any> {
  return priapi(`/priapi/v1/aieco/agent/communication-check`);
}

export async function saveSessionTokens(data: any): Promise<void> {
  const s = loadSession() ?? { accessToken: "" };
  saveSession({
    ...s,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken ?? s.refreshToken,
    expiresAt: data.expiresAt ?? data.expireAt,
    accountId: data.accountId ?? s.accountId,
    accountName: data.accountName ?? s.accountName,
  });
}
