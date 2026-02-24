import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getPrismaClient } from "../lib/prisma.js";
import { requireCurrentUser } from "../lib/permissions.js";

type UserWithAgents = {
  id: string;
  address: string;
  username: string | null;
  email: string | null;
  imageUrl: string | null;
  authMethod: string | null;
  totalVolume: { toString(): string };
  pnl: { toString(): string };
  createdAt: Date;
  updatedAt: Date;
  agents: { id: string; name: string; status: string }[];
};

function serializeMe(user: UserWithAgents) {
  return {
    id: user.id,
    address: user.address,
    username: user.username ?? null,
    email: user.email ?? null,
    imageUrl: user.imageUrl ?? null,
    authMethod: user.authMethod ?? null,
    totalVolume: user.totalVolume.toString(),
    pnl: user.pnl.toString(),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    agents: user.agents,
  };
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/auth/me – current user details (JWT only).
   * Returns 401 if not authenticated, 403 if not registered.
   */
  app.get("/api/auth/me", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireCurrentUser(req, reply);
    if (!user) return;
    const prisma = getPrismaClient();
    const agents = await prisma.agent.findMany({
      where: { ownerId: user.id },
      select: { id: true, name: true, status: true },
    });
    return reply.send(
      serializeMe({ ...user, agents } as UserWithAgents)
    );
  });
}
