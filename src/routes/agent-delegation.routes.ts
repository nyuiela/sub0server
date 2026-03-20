/**
 * Agent delegation endpoints (ERC-7710).
 *
 * Users sign one EIP-712 delegation when creating/funding an agent.
 * The delegation encodes caveats (maxExposureUsd, allowedMarketTypes, expiry)
 * that ACE verifies before every trade. Works with any EIP-712 wallet.
 *
 * POST /api/agents/:id/delegation — store signed delegation after user signs
 * GET  /api/agents/:id/delegation — retrieve delegation for ACE verification
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getPrismaClient } from "../lib/prisma.js";
import { requireAgentOwnerOrApiKey } from "../lib/permissions.js";
import { requireApiKeyOnly } from "../lib/permissions.js";

interface DelegationBody {
  delegationHash: string;
  delegationSignature: string;
  delegationExpiry: string;
  delegator: string;
  maxExposureUsd?: number;
  allowedMarketTypes?: string[];
}

interface DelegationParams {
  id: string;
}

function isValidHex(value: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(value);
}

function isValidISODate(value: string): boolean {
  const d = new Date(value);
  return !isNaN(d.getTime()) && d > new Date();
}

async function storeDelegation(
  req: FastifyRequest<{ Params: DelegationParams; Body: DelegationBody }>,
  reply: FastifyReply
): Promise<void> {
  if (!(await requireAgentOwnerOrApiKey(req, reply))) return;

  const { id } = req.params;
  const { delegationHash, delegationSignature, delegationExpiry, delegator, maxExposureUsd, allowedMarketTypes } =
    req.body ?? {};

  if (!delegationHash || !isValidHex(delegationHash)) {
    return reply.code(400).send({ error: "delegationHash must be a valid hex string" });
  }
  if (!delegationSignature || !isValidHex(delegationSignature)) {
    return reply.code(400).send({ error: "delegationSignature must be a valid hex string" });
  }
  if (!delegationExpiry || !isValidISODate(delegationExpiry)) {
    return reply.code(400).send({ error: "delegationExpiry must be a future ISO datetime" });
  }
  if (!delegator || !/^0x[0-9a-fA-F]{40}$/.test(delegator)) {
    return reply.code(400).send({ error: "delegator must be a valid Ethereum address" });
  }

  const prisma = getPrismaClient();
  const agent = await prisma.agent.findUnique({
    where: { id },
    select: { id: true, ownerId: true, walletAddress: true },
  });

  if (!agent) return reply.code(404).send({ error: "Agent not found" });
  if (!agent.walletAddress) {
    return reply.code(409).send({ error: "Agent wallet not yet created; create wallet before delegating" });
  }

  await prisma.agent.update({
    where: { id },
    data: {
      delegationHash,
      delegationSignature,
      delegationExpiry: new Date(delegationExpiry),
    },
  });

  req.log.info({ agentId: id, delegator, maxExposureUsd }, "[delegation] stored ERC-7710 delegation");

  return reply.code(200).send({
    ok: true,
    agentId: id,
    delegationHash,
    delegationExpiry,
    delegate: agent.walletAddress,
    delegator,
    maxExposureUsd: maxExposureUsd ?? null,
    allowedMarketTypes: allowedMarketTypes ?? null,
  });
}

async function getDelegation(
  req: FastifyRequest<{ Params: DelegationParams }>,
  reply: FastifyReply
): Promise<void> {
  // Both the agent owner (frontend) and CRE/backend API key (ACE guard) can read
  const isApiKey = requireApiKeyOnly(req, reply);
  if (!isApiKey && !(await requireAgentOwnerOrApiKey(req, reply))) return;

  const { id } = req.params;
  const prisma = getPrismaClient();
  const agent = await prisma.agent.findUnique({
    where: { id },
    select: {
      id: true,
      walletAddress: true,
      delegationHash: true,
      delegationSignature: true,
      delegationExpiry: true,
      strategy: { select: { maxExposureUsd: true, allowedMarketTypes: true, riskLevel: true } },
    },
  });

  if (!agent) return reply.code(404).send({ error: "Agent not found" });

  const now = new Date();
  const expired = agent.delegationExpiry != null && agent.delegationExpiry < now;

  return reply.code(200).send({
    agentId: id,
    delegate: agent.walletAddress,
    delegationHash: agent.delegationHash,
    delegationSignature: agent.delegationSignature,
    delegationExpiry: agent.delegationExpiry?.toISOString() ?? null,
    active: !!agent.delegationHash && !expired,
    expired,
    strategy: agent.strategy ?? null,
  });
}

async function getAgentERC8004(
  req: FastifyRequest<{ Params: DelegationParams }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = req.params;
  const prisma = getPrismaClient();
  const agent = await prisma.agent.findUnique({
    where: { id },
    select: { id: true, walletAddress: true, erc8004TokenId: true },
  });
  if (!agent) return reply.code(404).send({ error: "Agent not found" });

  return reply.code(200).send({
    agentId: id,
    walletAddress: agent.walletAddress,
    erc8004TokenId: agent.erc8004TokenId,
    reputationScore: null,
    validationProofCount: 0,
    lastProofHash: null,
    hasIdentity: !!agent.erc8004TokenId,
  });
}

export async function registerAgentDelegationRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: DelegationParams; Body: DelegationBody }>(
    "/api/agents/:id/delegation",
    storeDelegation
  );
  app.get<{ Params: DelegationParams }>(
    "/api/agents/:id/delegation",
    getDelegation
  );
  app.get<{ Params: DelegationParams }>(
    "/api/agents/:id/erc8004",
    getAgentERC8004
  );
}
