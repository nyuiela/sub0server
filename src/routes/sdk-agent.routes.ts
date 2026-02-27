/**
 * BYOA SDK routes: agent registration (api_key + claim_url) and claim (wallet binding).
 * No auth required for register or claim; agent routes use Bearer api_key.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getPrismaClient } from "../lib/prisma.js";
import { getAgentRegistrationModel } from "../lib/agent-registration-db.js";
import { requestCreCreateAgentKey } from "../lib/cre-create-agent-key.js";
import { registerSdkAgent } from "../services/agent-registration.service.js";
import { recoverAddressFromSignature, normalizeAddress } from "../lib/verify-signature.js";
import { CRE_PENDING_PRIVATE_KEY } from "../schemas/agent.schema.js";
import type { SdkAgentRegisterBody, SdkClaimSubmitBody } from "../types/sdk-agent.js";

export async function registerSdkAgentRoutes(app: FastifyInstance): Promise<void> {
  /** POST /api/sdk/agents/register – create agent registration, return api_key and claim_url */
  app.post<{ Body: SdkAgentRegisterBody }>(
    "/api/sdk/agents/register",
    async (req: FastifyRequest<{ Body: SdkAgentRegisterBody }>, reply: FastifyReply) => {
      const name = req.body?.name;
      const result = await registerSdkAgent(typeof name === "string" ? name : undefined);
      return reply.code(201).send(result);
    }
  );

  /** GET /api/sdk/claim/:claimCode – public claim info (no secrets) */
  app.get<{ Params: { claimCode: string } }>(
    "/api/sdk/claim/:claimCode",
    async (req: FastifyRequest<{ Params: { claimCode: string } }>, reply: FastifyReply) => {
      const claimCode = req.params?.claimCode?.trim();
      if (!claimCode) {
        return reply.code(400).send({ error: "Missing claimCode" });
      }
      const agentReg = getAgentRegistrationModel();
      const reg = await agentReg.findUnique({
        where: { claimCode },
        select: { status: true, name: true, claimCode: true },
      });
      if (!reg) {
        return reply.code(404).send({ error: "Claim not found" });
      }
      return reply.send({
        claim_code: reg.claimCode as string,
        status: (reg.status as string) as "UNCLAIMED" | "CLAIMED",
        ...((reg.name as string | null) ? { agent_name: reg.name as string } : {}),
      });
    }
  );

  /** POST /api/sdk/claim/:claimCode – bind wallet to agent (claim). Body: address, signature, message (SIWE or similar). */
  app.post<{
    Params: { claimCode: string };
    Body: SdkClaimSubmitBody;
  }>(
    "/api/sdk/claim/:claimCode",
    async (
      req: FastifyRequest<{ Params: { claimCode: string }; Body: SdkClaimSubmitBody }>,
      reply: FastifyReply
    ) => {
      const claimCode = req.params?.claimCode?.trim();
      if (!claimCode) {
        return reply.code(400).send({ error: "Missing claimCode" });
      }
      const body = req.body;
      const address = typeof body?.address === "string" ? body.address.trim() : "";
      const signature = typeof body?.signature === "string" ? body.signature : "";
      const message = typeof body?.message === "string" ? body.message : "";
      if (!address || !signature || !message) {
        return reply.code(400).send({ error: "address, signature, and message are required" });
      }
      const normalizedAddress = normalizeAddress(address);
      const sigHex = signature.startsWith("0x") ? (signature as `0x${string}`) : (`0x${signature}` as `0x${string}`);
      const recovered = await recoverAddressFromSignature(message, sigHex);
      if (!recovered || recovered !== normalizedAddress.toLowerCase()) {
        return reply.code(401).send({ error: "Invalid signature for this address" });
      }

      const prisma = getPrismaClient();
      const agentReg = getAgentRegistrationModel();
      const reg = await agentReg.findUnique({
        where: { claimCode },
        select: {
          id: true,
          status: true,
          name: true,
          walletAddress: true,
          encryptedPrivateKey: true,
        },
      });
      if (!reg) {
        return reply.code(404).send({ error: "Claim not found" });
      }
      if ((reg.status as string) === "CLAIMED") {
        return reply.code(409).send({ error: "Already claimed" });
      }

      let user = await prisma.user.findUnique({
        where: { address: normalizedAddress.toLowerCase() },
        select: { id: true },
      });
      if (!user) {
        user = await prisma.user.create({
          data: {
            address: normalizedAddress.toLowerCase(),
            authMethod: "WALLET",
          },
          select: { id: true },
        });
      }

      /* BYOA: registration has wallet/key or CRE pending. If pending, CRE will POST /api/cre/agent-keys later. */
      const agentWallet = reg.walletAddress as string;
      const encKey = reg.encryptedPrivateKey as string;
      const isCrePending = encKey === CRE_PENDING_PRIVATE_KEY;
      const agent = await prisma.agent.create({
        data: {
          ownerId: user.id,
          name: (reg.name as string | null) ?? "Claimed Agent",
          persona: (reg.name as string | null) ?? "Claimed Agent",
          publicKey: agentWallet,
          walletAddress: isCrePending ? null : agentWallet,
          encryptedPrivateKey: encKey,
          modelSettings: {},
        },
        select: { id: true },
      });

      if (isCrePending) {
        await requestCreCreateAgentKey(agent.id);
      }

      await agentReg.update({
        where: { id: reg.id as string },
        data: {
          status: "CLAIMED",
          claimedByUserId: user.id,
          claimedAgentId: agent.id,
        },
      });

      return reply.send({
        success: true,
        agent_id: agent.id,
        user_id: user.id,
      });
    }
  );
}
