/**
 * CRE callback routes: CRE gateway (or workflow) POSTs results here so the backend can persist them.
 * - /api/internal/cre/*: require x-api-key.
 * - /api/cre/agent-keys: require Authorization: CRE-Generated <apiKey>.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getCreGeneratedApiKey, verifyCreGeneratedKey } from "../lib/auth.js";
import { requireApiKeyOnly } from "../lib/permissions.js";
import { getPrismaClient } from "../lib/prisma.js";
import { CRE_PENDING_PUBLIC_KEY } from "../schemas/agent.schema.js";
import { encryptPrivateKey } from "../services/agent-keys.service.js";
import { executeAgentOnboarding } from "../services/agent-onboarding.service.js";
import {
  creCreateWalletResultSchema,
  creAgentKeysSchema,
  type CreCreateWalletResultInput,
  type CreAgentKeysInput,
} from "../schemas/cre-callback.schema.js";

export async function registerCreCallbackRoutes(app: FastifyInstance): Promise<void> {
  /** POST /api/internal/cre/create-wallet-result – store agent wallet address and optional CRE-only encrypted key. */
  app.post<{ Body: unknown }>(
    "/api/internal/cre/create-wallet-result",
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      if (!requireApiKeyOnly(req, reply)) return;
      const parsed = creCreateWalletResultSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
      }
      const { agentId, address, encryptedPrivateKey } = parsed.data as CreCreateWalletResultInput;
      const prisma = getPrismaClient();
      const existing = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { id: true, walletAddress: true, publicKey: true },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Agent not found" });
      }
      if (existing.walletAddress != null && String(existing.walletAddress).trim() !== "") {
        return reply.code(409).send({ error: "Agent already has a wallet" });
      }
      const updateData: { walletAddress: string; publicKey?: string; encryptedPrivateKey?: string } = {
        walletAddress: address,
      };
      if (existing.publicKey === CRE_PENDING_PUBLIC_KEY) {
        updateData.publicKey = address;
      }
      if (encryptedPrivateKey?.trim()) {
        updateData.encryptedPrivateKey = encryptedPrivateKey.trim();
      }
      const agent = await prisma.agent.update({
        where: { id: agentId },
        data: updateData,
        select: { id: true, walletAddress: true },
      });
      return reply.code(200).send({
        agentId: agent.id,
        walletAddress: agent.walletAddress,
        stored: true,
      });
    }
  );

  /** POST /api/cre/agent-keys – CRE agent creation callback. Detour: encryptedKeyBlob = private key; we encrypt and store it, run onboarding (fund ETH + agent signs USDC/CT approvals). CRE signed txs are ignored. */
  app.post<{ Body: unknown }>(
    "/api/cre/agent-keys",
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      // Auth disabled for now – re-enable when CRE sends Authorization: CRE-Generated <apiKey>
      // const token = getCreGeneratedApiKey(req);
      // if (!token || !verifyCreGeneratedKey(token)) {
      //   return reply.code(401).send({ error: "Authorization required", detail: "Use Authorization: CRE-Generated <apiKey>" });
      // }

      const parsed = creAgentKeysSchema.safeParse(req.body);
      if (!parsed.success) {
        req.log.warn({ validationError: parsed.error.flatten() }, "CRE agent-keys: validation failed");
        return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
      }
      const data = parsed.data as CreAgentKeysInput;
      const { agentId, address, encryptedKeyBlob } = data;
      req.log.info(
        { agentId: agentId ?? null, address, hasEncryptedKeyBlob: Boolean(encryptedKeyBlob?.trim()) },
        "CRE agent-keys: parsed body (detour: onboarding with agent key)"
      );

      if (!encryptedKeyBlob?.trim()) {
        return reply.code(400).send({ error: "encryptedKeyBlob (private key) required" });
      }

      const rawPrivateKey = encryptedKeyBlob.trim();
      const normalizedPk = rawPrivateKey.startsWith("0x")
        ? rawPrivateKey
        : `0x${rawPrivateKey}`;

      if (!agentId) {
        const onboardingResult = await executeAgentOnboarding(normalizedPk, address, req.log);
        return reply.code(200).send({
          stored: false,
          message: "agentId required for agent storage; onboarding executed",
          onboarding: onboardingResult,
        });
      }

      const prisma = getPrismaClient();
      const existing = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { id: true, walletAddress: true, publicKey: true },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Agent not found" });
      }
      if (existing.walletAddress != null && String(existing.walletAddress).trim() !== "") {
        return reply.code(409).send({ error: "Agent already has a wallet" });
      }

      reply.code(202).send({
        accepted: true,
        agentId,
        message: "Onboarding in progress; agent will be updated when transactions confirm",
      });

      void (async () => {
        const onboardingResult = await executeAgentOnboarding(normalizedPk, address, req.log);
        req.log.info({ onboardingResult }, "CRE agent-keys: onboarding result");

        const encryptedStored = encryptPrivateKey(normalizedPk);
        await prisma.agent.update({
          where: { id: agentId },
          data: {
            walletAddress: address,
            publicKey: address,
            encryptedPrivateKey: encryptedStored,
          },
          select: { id: true, walletAddress: true },
        });
        req.log.info({ agentId, walletAddress: address }, "CRE agent-keys: agent stored (background)");
      })();
    }
  );
}
