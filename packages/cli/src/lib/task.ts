import {
  createAndFund,
  createAndFundConfirmStatus,
  myTasks,
  providerConfirmStatus,
  signMessage,
  taskDetail,
  type CreateTaskInput,
} from "./priapi.js";
import { requireSession } from "./session.js";

/**
 * Deterministic serialization of the escrow (uopData) parameters for the
 * wallet signature. Mirrors the reference `sign_uop` semantics: the signature
 * authorizes exactly these escrow terms. Verify against live
 * createAndFundConfirmStatus responses during integration.
 */
function escrowSignMessage(jobId: string, taskSalt: string, uop: any): string {
  const fields = [
    "receiver", "evaluator", "currency", "recipient", "amount",
    "submitWindow", "disputeWindow", "evaluateWindow", "completedWindow",
    "hook", "hookData", "salt", "expiredAt",
  ];
  const lines = [`SnowAgent task escrow authorization`, `jobId: ${jobId}`, `taskSalt: ${taskSalt}`];
  for (const f of fields) lines.push(`${f}: ${uop?.[f] ?? ""}`);
  return lines.join("\n");
}

export async function createTask(input: CreateTaskInput): Promise<{ jobId: string }> {
  requireSession();

  // 1. confirm → jobId + taskSalt + uopData (escrow terms)
  const confirm = await createAndFundConfirmStatus({
    providerAgentId: input.providerAgentId,
    tokenSymbol: input.tokenSymbol,
    amount: input.tokenAmount,
    chainId: input.chainId,
    serviceId: input.serviceId,
  });
  const jobId: string = confirm.jobId ?? confirm.data?.jobId;
  const taskSalt: string = confirm.taskSalt ?? confirm.data?.taskSalt ?? "";
  const uopData = confirm.uopData ?? confirm.data?.uopData;
  if (!jobId || !uopData) throw new Error("createAndFundConfirmStatus returned no jobId/uopData");

  // 2. wallet signs the escrow authorization (TEE — key never leaves backend)
  const message = escrowSignMessage(jobId, taskSalt, uopData);
  const { signature } = await signMessage({ message });
  const validAfter = String(Math.floor(Date.now() / 1000));
  const validBefore = String(uopData.expiredAt ?? Math.floor(Date.now() / 1000) + 3600);

  // 3. create + fund
  const body: Record<string, unknown> = {
    visibility: input.visibility ?? "public",
    jobId,
    taskSalt,
    signature,
    validAfter: Number(validAfter),
    validBefore: Number(validBefore),
    title: input.title,
    description: input.description,
    paymentTokenSymbol: input.tokenSymbol,
    paymentTokenAmount: input.tokenAmount,
    chainId: input.chainId,
    providerAgentId: input.providerAgentId,
    serviceId: input.serviceId,
    serviceParams: input.serviceParams ?? {},
  };
  if (input.serviceTokenAddress) body.serviceTokenAddress = input.serviceTokenAddress;
  if (input.serviceTokenAmount) body.serviceTokenAmount = input.serviceTokenAmount;

  const res = await createAndFund(body);
  const createdJobId: string = res.jobId ?? res.data?.jobId ?? jobId;
  return { jobId: createdJobId };
}

export async function taskStatus(jobId: string): Promise<any> {
  requireSession();
  try {
    return await taskDetail(jobId);
  } catch {
    // fallback: scan my tasks
    const list = await myTasks({ page: 1, pageSize: 50 });
    const items: any[] = list.list ?? list.records ?? list.data ?? [];
    const hit = items.find((t: any) => t.jobId === jobId || t.job_id === jobId);
    if (!hit) throw new Error(`task ${jobId} not found`);
    return hit;
  }
}

export async function listTasks(statusType = 1): Promise<any> {
  requireSession();
  return myTasks({ statusType });
}

/**
 * Accept a delivered result (user-side review accept).
 * Queries provider confirm status first so the acceptance references the
 * exact escrow terms, then posts the acceptance.
 */
export async function acceptTask(jobId: string): Promise<any> {
  requireSession();
  const detail: any = await taskStatus(jobId);
  const providerAgentId: string = detail.providerAgentId ?? detail.provider_agent_id ?? "";
  const tokenSymbol: string = detail.paymentTokenSymbol ?? detail.tokenSymbol ?? "";
  const amount: string = detail.paymentTokenAmount ?? detail.amount ?? "";

  let confirm: any = null;
  try {
    confirm = await providerConfirmStatus(jobId, {
      providerAgentId,
      tokenSymbol,
      amount,
    });
  } catch {
    // provider may not have quoted; acceptance can still proceed
  }

  const { signMessage: sign } = await import("./priapi.js");
  const message = [
    "SnowAgent task accept",
    `jobId: ${jobId}`,
    `providerAgentId: ${providerAgentId}`,
    `amount: ${amount} ${tokenSymbol}`,
  ].join("\n");
  const { signature } = await sign({ message });

  const { priapi } = await import("./priapi.js");
  return priapi(`/priapi/v1/aieco/task/${encodeURIComponent(jobId)}/accept`, {
    body: { jobId, signature, providerConfirm: confirm ?? undefined },
  });
}
