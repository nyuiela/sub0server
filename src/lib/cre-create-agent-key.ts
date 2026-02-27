/**
 * Request CRE to create an agent key (createAgentKey). CRE will POST to /api/cre/agent-keys when ready.
 * Uses GET request with query params; no wallet is created in the backend.
 */

import { config } from "../config/index.js";
import { getPrismaClient } from "./prisma.js";
import type { CreCreateAgentKeyPayload } from "../types/agent-markets.js";

export function toCreCreateAgentKeyPayload(
  agentId: string,
  funderNonce: number,
  apiKey?: string
): CreCreateAgentKeyPayload {
  const payload: CreCreateAgentKeyPayload = {
    action: "createAgentKey",
    agentId,
    funderNonce,
  };
  if (apiKey?.trim()) payload.apiKey = apiKey.trim();
  return payload;
}

/**
 * Send GET request to CRE to create agent key. CRE will callback POST /api/cre/agent-keys.
 * Returns true if request was sent, false if CRE URL not configured.
 */
export async function requestCreCreateAgentKey(agentId: string): Promise<boolean> {
  const creUrl = config.creHttpUrl?.trim();
  if (!creUrl) return false;

  const prisma = getPrismaClient();
  const funderNonce = await prisma.agent.count();
  const apiKey = config.creHttpApiKey?.trim();
  const payload = toCreCreateAgentKeyPayload(agentId, funderNonce, apiKey);

  const params = new URLSearchParams({
    action: payload.action,
    agentId: payload.agentId,
    funderNonce: String(payload.funderNonce),
  });
  if (payload.apiKey) params.set("apiKey", payload.apiKey);

  const url = `${creUrl}${creUrl.includes("?") ? "&" : "?"}${params.toString()}`;
  try {
    const res = await fetch(url, { method: "POST", body: JSON.stringify(payload) });
    return res.ok;
  } catch {
    return false;
  }
}
