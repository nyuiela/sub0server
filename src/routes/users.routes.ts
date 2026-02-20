import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getPrismaClient } from "../lib/prisma.js";
import {
  userCreateSchema,
  userUpdateSchema,
  userQuerySchema,
  type UserCreateInput,
  type UserUpdateInput,
  type UserQueryInput,
} from "../schemas/user.schema.js";

function serializeUser(user: { id: string; address: string; email: string | null; totalVolume: { toString(): string }; pnl: { toString(): string }; createdAt: Date; updatedAt: Date }) {
  return {
    ...user,
    totalVolume: user.totalVolume.toString(),
    pnl: user.pnl.toString(),
  };
}

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/users", async (req: FastifyRequest<{ Querystring: UserQueryInput }>, reply: FastifyReply) => {
    const parsed = userQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    const { limit, offset } = parsed.data;
    const prisma = getPrismaClient();
    const [users, total] = await Promise.all([
      prisma.user.findMany({ take: limit, skip: offset, orderBy: { createdAt: "desc" } }),
      prisma.user.count(),
    ]);
    return reply.send({
      data: users.map(serializeUser),
      total,
      limit,
      offset,
    });
  });

  app.get("/api/users/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { agents: { select: { id: true, name: true, status: true } } },
    });
    if (!user) return reply.code(404).send({ error: "User not found" });
    return reply.send(serializeUser(user));
  });

  app.get("/api/users/address/:address", async (req: FastifyRequest<{ Params: { address: string } }>, reply: FastifyReply) => {
    const prisma = getPrismaClient();
    const user = await prisma.user.findUnique({
      where: { address: req.params.address },
      include: { agents: { select: { id: true, name: true, status: true } } },
    });
    if (!user) return reply.code(404).send({ error: "User not found" });
    return reply.send(serializeUser(user));
  });

  app.post("/api/users", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    const parsed = userCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const prisma = getPrismaClient();
    const user = await prisma.user.create({ data: parsed.data });
    return reply.code(201).send(serializeUser(user));
  });

  app.patch("/api/users/:id", async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply: FastifyReply) => {
    const parsed = userUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const prisma = getPrismaClient();
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: parsed.data,
    }).catch(() => null);
    if (!user) return reply.code(404).send({ error: "User not found" });
    return reply.send(serializeUser(user));
  });

  app.delete("/api/users/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const prisma = getPrismaClient();
    await prisma.user.delete({ where: { id: req.params.id } }).catch(() => null);
    return reply.code(204).send();
  });
}
