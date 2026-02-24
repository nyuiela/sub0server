import type { FastifyRequest, FastifyReply } from "fastify";
import { getPrismaClient } from "./prisma.js";
import { requireUser, requireApiKey } from "./auth.js";
import type { User } from "@prisma/client";

/**
 * Require any auth (user or API key). Returns 401 if unauthenticated.
 */
export function requireAuth(req: FastifyRequest): boolean {
  return req.auth != null;
}

/**
 * Send 401 if no auth, 403 if not API key. Returns true if API key.
 */
export function requireApiKeyOnly(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!requireAuth(req)) {
    reply.code(401).send({ error: "Authentication required" });
    return false;
  }
  if (!requireApiKey(req)) {
    reply.code(403).send({ error: "API key required" });
    return false;
  }
  return true;
}

/**
 * Send 401 if no auth. Require user (JWT) or API key. Returns true if allowed.
 */
export function requireUserOrApiKey(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!requireAuth(req)) {
    reply.code(401).send({ error: "Authentication required" });
    return false;
  }
  return true;
}

/**
 * Require JWT user (no API key). Resolve current user from DB by userId or address.
 * Returns the User record or sends 401/403 and returns null.
 */
export async function requireCurrentUser(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<User | null> {
  if (!requireAuth(req)) {
    reply.code(401).send({ error: "Authentication required" });
    return null;
  }
  if (requireApiKey(req)) {
    reply.code(403).send({ error: "Settings endpoints require user session" });
    return null;
  }
  const authUser = requireUser(req);
  if (!authUser?.address) {
    reply.code(403).send({ error: "User not found" });
    return null;
  }
  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({
    where: authUser.userId ? { id: authUser.userId } : { address: authUser.address },
  });
  if (!user) {
    reply.code(403).send({ error: "User not found or not registered" });
    return null;
  }
  return user;
}

/**
 * Allow only if: API key, or user and resource userId matches auth userId.
 */
export async function requireOwnUserOrApiKey(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<boolean> {
  if (!requireAuth(req)) {
    reply.code(401).send({ error: "Authentication required" });
    return false;
  }
  if (requireApiKey(req)) return true;
  const user = requireUser(req);
  if (!user?.userId) {
    reply.code(403).send({ error: "User not found or not registered" });
    return false;
  }
  if (user.userId !== req.params.id) {
    reply.code(403).send({ error: "Forbidden: not your user record" });
    return false;
  }
  return true;
}

/**
 * Allow only if: API key, or user is the agent owner.
 */
export async function requireAgentOwnerOrApiKey(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<boolean> {
  if (!requireAuth(req)) {
    reply.code(401).send({ error: "Authentication required" });
    return false;
  }
  if (requireApiKey(req)) return true;
  const user = requireUser(req);
  if (!user?.userId) {
    reply.code(403).send({ error: "User not found or not registered" });
    return false;
  }
  const prisma = getPrismaClient();
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id }, select: { ownerId: true } });
  if (!agent) {
    reply.code(404).send({ error: "Agent not found" });
    return false;
  }
  if (agent.ownerId !== user.userId) {
    reply.code(403).send({ error: "Forbidden: not your agent" });
    return false;
  }
  return true;
}

/**
 * Allow only if: API key, or user address is market creator.
 */
export async function requireMarketCreatorOrApiKey(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<boolean> {
  if (!requireAuth(req)) {
    reply.code(401).send({ error: "Authentication required" });
    return false;
  }
  if (requireApiKey(req)) return true;
  const user = requireUser(req);
  if (!user?.address) {
    reply.code(403).send({ error: "Authentication required" });
    return false;
  }
  const prisma = getPrismaClient();
  const market = await prisma.market.findUnique({ where: { id: req.params.id }, select: { creatorAddress: true } });
  if (!market) {
    reply.code(404).send({ error: "Market not found" });
    return false;
  }
  if (market.creatorAddress.toLowerCase() !== user.address.toLowerCase()) {
    reply.code(403).send({ error: "Forbidden: not market creator" });
    return false;
  }
  return true;
}

/**
 * Allow only if: API key, or user owns the position (userId match or agent owner).
 */
export async function requirePositionOwnerOrApiKey(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<boolean> {
  if (!requireAuth(req)) {
    reply.code(401).send({ error: "Authentication required" });
    return false;
  }
  if (requireApiKey(req)) return true;
  const user = requireUser(req);
  if (!user?.userId) {
    reply.code(403).send({ error: "User not found or not registered" });
    return false;
  }
  const prisma = getPrismaClient();
  const position = await prisma.position.findUnique({
    where: { id: req.params.id },
    select: { userId: true, agentId: true },
  });
  if (!position) {
    reply.code(404).send({ error: "Position not found" });
    return false;
  }
  if (position.userId === user.userId) return true;
  if (position.agentId) {
    const agent = await prisma.agent.findUnique({ where: { id: position.agentId }, select: { ownerId: true } });
    if (agent?.ownerId === user.userId) return true;
  }
  reply.code(403).send({ error: "Forbidden: not your position" });
  return false;
}

/**
 * Allow only if: API key, or user is the agent owner (for strategy by agentId).
 */
export async function requireStrategyAgentOwnerOrApiKey(
  req: FastifyRequest<{ Params: { agentId: string } }>,
  reply: FastifyReply
): Promise<boolean> {
  return requireAgentOwnerOrApiKeyById(req, reply, req.params.agentId);
}

/**
 * Allow only if: API key, or user is the owner of the given agent (by id).
 */
export async function requireAgentOwnerOrApiKeyById(
  req: FastifyRequest,
  reply: FastifyReply,
  agentId: string
): Promise<boolean> {
  if (!requireAuth(req)) {
    reply.code(401).send({ error: "Authentication required" });
    return false;
  }
  if (requireApiKey(req)) return true;
  const user = requireUser(req);
  if (!user?.userId) {
    reply.code(403).send({ error: "User not found or not registered" });
    return false;
  }
  const prisma = getPrismaClient();
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { ownerId: true } });
  if (!agent) {
    reply.code(404).send({ error: "Agent not found" });
    return false;
  }
  if (agent.ownerId !== user.userId) {
    reply.code(403).send({ error: "Forbidden: not your agent" });
    return false;
  }
  return true;
}
