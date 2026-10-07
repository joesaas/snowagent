import {
  aieco,
  createAndFund,
  createAndFundConfirmStatus,
  myTasks,
  providerConfirmStatus,
  taskDetail,
  type CreateTaskInput,
} from "./priapi.js";
import { signEscrow } from "./escrow.js";
import { signMessage } from "./sign.js";
import { requireSession } from "./session.js";

/** Resolve fee token address/amount from the service catalog when not given. */
async function resolveServiceFee(serviceId: string): Promise<{ address: string; amount: string }> {
  const { priapi } = await import("./priapi.js");
  const r: any = await priapi(`/priapi/v1/aieco/task/asp/service/search`, {
    body: { sid: serviceId, limit: 1 },
  });
  const s = r?.services?.[0];
  if (!s) throw new Error(`service ${serviceId} not found`);
  return { address: s.feeToken, amount: String(s.feeAmount) };
}

export async function createTask(input: CreateTaskInput): Promise<{ jobId: string }> {
  requireSession();

  // 1. confirm → escrow terms (jobId, taskSalt, provider/receiver/evaluator/...)
  const c: any = await createAndFundConfirmStatus({
    providerAgentId: input.providerAgentId,
    tokenSymbol: input.tokenSymbol,
    amount: input.tokenAmount,
    chainId: input.chainId,
    serviceId: input.serviceId,
  });
  for (const k of ["jobId", "taskSalt", "provider", "receiver", "evaluator", "currency", "recipient", "amount", "salt", "expiredAt"]) {
    if (c[k] === undefined) throw new Error(`createAndFundConfirmStatus missing ${k}`);
  }

  // 2. TEE-sign the EIP-3009 escrow authorization (key never leaves backend)
  const auth = await signEscrow(
    {
      from: "", // resolved inside signEscrow from the wallet
      provider: c.hook, // provider_for_escrow_nonce() == hook
      receiver: c.receiver,
      arbitrator: c.evaluator,
      currency: c.currency,
      amount: c.amount,
      submitWindow: c.submitWindow,
      disputeWindow: c.disputeWindow,
      arbitrationWindow: c.evaluateWindow,
      terminationWindow: c.completedWindow,
      hook: c.hook,
      hookData: c.hookData,
      salt: c.salt,
      chainId: input.chainId,
      escrowAddress: c.recipient,
    },
    String(c.expiredAt)
  );

  // 3. fee token info (auto-resolve when not provided)
  let serviceTokenAddress = input.serviceTokenAddress;
  let serviceTokenAmount = input.serviceTokenAmount;
  if (!serviceTokenAddress || !serviceTokenAmount) {
    const fee = await resolveServiceFee(input.serviceId);
    serviceTokenAddress = serviceTokenAddress ?? fee.address;
    serviceTokenAmount = serviceTokenAmount ?? fee.amount;
  }

  // 4. create + fund (visibility: public=0/private=1; chainId numeric; serviceParams as JSON string)
  const visibility = (input.visibility ?? "public") === "private" ? 1 : 0;
  const body: Record<string, unknown> = {
    visibility,
    jobId: c.jobId,
    taskSalt: c.taskSalt,
    signature: auth.signature,
    validAfter: Number(auth.validAfter),
    validBefore: Number(auth.validBefore),
    title: input.title,
    description: input.description,
    paymentTokenSymbol: input.tokenSymbol,
    paymentTokenAmount: input.tokenAmount,
    chainId: Number(input.chainId),
    providerAgentId: input.providerAgentId,
    serviceId: input.serviceId,
    serviceParams: JSON.stringify(input.serviceParams ?? {}),
    serviceTokenAddress,
    serviceTokenAmount,
  };
  const res: any = await createAndFund(body);
  // validate like the reference: jobId must match, uopData present
  const createdJobId: string = res?.jobId ?? "";
  if (!createdJobId || createdJobId !== c.jobId) {
    throw new Error(`createAndFund returned unexpected jobId: ${createdJobId || "<empty>"}`);
  }
  if (!res.uopData) throw new Error("createAndFund response missing uopData");
  const bizType = Number(res.type ?? 201);
  if (res.type !== undefined && bizType !== 201) {
    throw new Error(`unexpected bizType ${res.type}, expected 201`);
  }

  // 5. broadcast — this is what makes the task live
  const { broadcastTask } = await import("./broadcast.js");
  await broadcastTask(createdJobId, res.uopData, bizType);
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

  const message = [
    "SnowAgent task accept",
    `jobId: ${jobId}`,
    `providerAgentId: ${providerAgentId}`,
    `amount: ${amount} ${tokenSymbol}`,
  ].join("\n");
  const { signature } = await signMessage({ message });

  const { priapi } = await import("./priapi.js");
  return priapi(`/priapi/v1/aieco/task/${encodeURIComponent(jobId)}/accept`, {
    body: { jobId, signature, providerConfirm: confirm ?? undefined },
  });
}
