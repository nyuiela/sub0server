/**
 * ENS CCIP-Read offchain resolver gateway.
 *
 * Sub0 agents get gasless ENS subnames: {slug}.sub0.eth
 * The Sub0ENSResolver contract points to this endpoint for CCIP-Read (EIP-3668).
 *
 * Supports:
 *   GET  /api/ens/resolve?name={name}&sender={sender}  — resolve {name} to agent walletAddress
 *   GET  /api/ens/name/:walletAddress                  — reverse lookup: address → ensName
 *   POST /api/internal/ens/assign                      — internal: assign ENS name to agent
 *
 * CCIP-Read response format:
 *   ABI-encoded (address wallet, uint64 expiry, bytes sig)
 *   sig = ECDSA over keccak256(abi.encode(name, wallet, expiry)) by BACKEND_SIGNER_PRIVATE_KEY
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createWalletClient, http, keccak256, encodePacked, encodeAbiParameters, parseAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { getPrismaClient } from "../lib/prisma.js";
import { requireApiKeyOnly } from "../lib/permissions.js";
import { config } from "../config/index.js";
import { deriveEnsSlug } from "../lib/ens-slug.js";

const CCIP_READ_TTL_SECONDS = 300; // 5 min cache

function buildSigner() {
  const raw = config.contractPrivateKey?.trim() ?? "";
  if (!raw) return null;
  try {
    return privateKeyToAccount(raw as `0x${string}`);
  } catch {
    return null;
  }
}

interface ResolveQuery {
  name?: string;
  sender?: string;
}

interface AssignBody {
  agentId?: string;
  name?: string;
}

async function resolveEns(
  req: FastifyRequest<{ Querystring: ResolveQuery }>,
  reply: FastifyReply
): Promise<void> {
  const { name } = req.query;
  if (!name || typeof name !== "string") {
    return reply.code(400).send({ error: "name query param required" });
  }

  const prisma = getPrismaClient();
  const agent = await prisma.agent.findFirst({
    where: { ensName: name.toLowerCase() },
    select: { id: true, walletAddress: true, ensName: true },
  });

  if (!agent?.walletAddress) {
    return reply.code(404).send({ error: `No agent found for ENS name: ${name}` });
  }

  const signer = buildSigner();
  if (!signer) {
    // No signer: return address without signature (unsigned mode for dev)
    req.log.warn("[ens-resolver] BACKEND_SIGNER_PRIVATE_KEY not set; returning unsigned address");
    return reply.code(200).send({
      name,
      address: agent.walletAddress,
      agentId: agent.id,
      signed: false,
    });
  }

  const expiry = BigInt(Math.floor(Date.now() / 1000) + CCIP_READ_TTL_SECONDS);
  const walletAddr = agent.walletAddress as `0x${string}`;

  // Sign: keccak256(abi.encode(name, walletAddr, expiry))
  const msgHash = keccak256(
    encodePacked(["string", "address", "uint64"], [name, walletAddr, expiry])
  );
  const client = createWalletClient({
    account: signer,
    chain: sepolia,
    transport: http(config.chainRpcUrl ?? "https://rpc.sepolia.org"),
  });
  const signature = await client.signMessage({ message: { raw: msgHash } });

  // ABI-encode for CCIP-Read: (address, uint64, bytes)
  const encoded = encodeAbiParameters(
    parseAbiParameters("address addr, uint64 expiry, bytes sig"),
    [walletAddr, expiry, signature]
  );

  return reply.code(200).send({
    name,
    address: agent.walletAddress,
    agentId: agent.id,
    signed: true,
    data: encoded,
    expiry: Number(expiry),
  });
}

async function reverseEns(
  req: FastifyRequest<{ Params: { walletAddress: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { walletAddress } = req.params;
  if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
    return reply.code(400).send({ error: "Invalid wallet address" });
  }

  const prisma = getPrismaClient();
  const agent = await prisma.agent.findFirst({
    where: { walletAddress: { equals: walletAddress, mode: "insensitive" } },
    select: { id: true, name: true, ensName: true },
  });

  if (!agent) {
    return reply.code(404).send({ error: "No agent found for this address" });
  }

  return reply.code(200).send({
    walletAddress,
    agentId: agent.id,
    ensName: agent.ensName,
    agentName: agent.name,
  });
}

async function assignEns(
  req: FastifyRequest<{ Body: AssignBody }>,
  reply: FastifyReply
): Promise<void> {
  if (!requireApiKeyOnly(req, reply)) return;

  const { agentId, name } = req.body ?? {};
  if (!agentId) return reply.code(400).send({ error: "agentId required" });

  const prisma = getPrismaClient();
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, name: true, ensName: true },
  });
  if (!agent) return reply.code(404).send({ error: "Agent not found" });

  const ensName = name?.toLowerCase().trim() ?? `${deriveEnsSlug(agent.name)}.sub0.eth`;
  const existing = await prisma.agent.findFirst({
    where: { ensName, NOT: { id: agentId } },
    select: { id: true },
  });
  if (existing) {
    return reply.code(409).send({ error: `ENS name ${ensName} is already taken` });
  }

  await prisma.agent.update({ where: { id: agentId }, data: { ensName } });
  req.log.info({ agentId, ensName }, "[ens-resolver] ENS name assigned");

  return reply.code(200).send({ ok: true, agentId, ensName });
}

export async function registerEnsResolverRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ResolveQuery }>("/api/ens/resolve", resolveEns);
  app.get<{ Params: { walletAddress: string } }>("/api/ens/name/:walletAddress", reverseEns);
  app.post<{ Body: AssignBody }>("/api/internal/ens/assign", assignEns);
}
