import { randomBytes } from "crypto";
import { getAgentRegistrationModel } from "../lib/agent-registration-db.js";
import { hashAgentApiKey } from "../lib/auth.js";
import { config } from "../config/index.js";
import { generateAgentKeys } from "./agent-keys.service.js";
import { CRE_PENDING_PUBLIC_KEY, CRE_PENDING_PRIVATE_KEY } from "../schemas/agent.schema.js";
import type { SdkAgentRegisterResponse } from "../types/sdk-agent.js";

const API_KEY_BYTES = 32;
const CLAIM_CODE_BYTES = 12;

function generateSecureToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url").replace(/[-_]/g, (c) => (c === "-" ? "A" : "B"));
}

function generateClaimCode(): string {
  return generateSecureToken(CLAIM_CODE_BYTES).slice(0, 16);
}

export async function registerSdkAgent(name?: string): Promise<SdkAgentRegisterResponse> {
  const apiKey = randomBytes(API_KEY_BYTES).toString("hex");
  const apiKeyHash = hashAgentApiKey(apiKey);
  let claimCode = generateClaimCode();
  const agentReg = getAgentRegistrationModel();

  const exists = await agentReg.findUnique({ where: { claimCode } });
  if (exists) {
    claimCode = generateClaimCode();
  }

  const useCre = Boolean(config.creHttpUrl?.trim());
  const keys = useCre ? null : generateAgentKeys();
  const walletAddress = useCre ? CRE_PENDING_PUBLIC_KEY : (keys?.publicKey ?? CRE_PENDING_PUBLIC_KEY);
  const encryptedPrivateKey = useCre ? CRE_PENDING_PRIVATE_KEY : (keys?.encryptedPrivateKey ?? CRE_PENDING_PRIVATE_KEY);

  let baseUrl = config.frontendBaseUrl.replace(/\/$/, "");
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    baseUrl = `https://${baseUrl}`;
  }
  const claimUrl = `${baseUrl}/claim/${claimCode}`;

  const reg = await agentReg.create({
    data: {
      apiKeyHash,
      claimCode,
      name: name?.trim() ?? null,
      status: "UNCLAIMED",
      walletAddress,
      encryptedPrivateKey,
    },
    select: { id: true },
  });
  const agentId = reg.id as string;

  return {
    agent_id: agentId,
    api_key: apiKey,
    claim_code: claimCode,
    claim_url: claimUrl,
    wallet_address: walletAddress,
    ...(name?.trim() ? { name: name.trim() } : {}),
  };
}
