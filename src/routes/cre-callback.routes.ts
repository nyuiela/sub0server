/**
 * CRE callback routes: CRE gateway (or workflow) POSTs results here so the backend can persist them.
 * All routes require API key (x-api-key). Used for agent wallet creation (Option 1: address only; Option 2: address + CRE-only ciphertext).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireApiKeyOnly } from "../lib/permissions.js";
import { getPrismaClient } from "../lib/prisma.js";
import { CRE_PENDING_PUBLIC_KEY } from "../schemas/agent.schema.js";
import { creCreateWalletResultSchema, type CreCreateWalletResultInput } from "../schemas/cre-callback.schema.js";

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
}
