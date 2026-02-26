import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getPrismaClient } from "../lib/prisma.js";
import { requireApiKey, requireUser } from "../lib/auth.js";

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
   * GET /api/auth/me – current user details when authenticated; no auth required.
   * Returns 200 with { user: <serialized user> } when logged in and registered,
   * or { user: null } when not authenticated or not registered. No 401.
   */
  app.get("/api/auth/me", async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.auth == null) {
      return reply.send({ user: null });
    }
    if (requireApiKey(req)) {
      return reply.send({ user: null });
    }
    const authUser = requireUser(req);
    if (!authUser?.address) {
      return reply.send({ user: null });
    }
    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: authUser.userId ? { id: authUser.userId } : { address: authUser.address },
    });
    if (!user) {
      return reply.send({ user: null });
    }
    const agents = await prisma.agent.findMany({
      where: { ownerId: user.id },
      select: { id: true, name: true, status: true },
    });
    return reply.send({
      user: serializeMe({ ...user, agents } as UserWithAgents),
    });
  });
}
