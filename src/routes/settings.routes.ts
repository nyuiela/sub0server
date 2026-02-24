import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Decimal } from "decimal.js";
import { getPrismaClient } from "../lib/prisma.js";
import { requireCurrentUser } from "../lib/permissions.js";
import { profileSchema, vaultAmountSchema, type ProfileInput } from "../schemas/settings.schema.js";

function serializeProfile(user: {
  username: string | null;
  email: string | null;
  pnl: { toString(): string };
  totalVolume: { toString(): string };
}) {
  return {
    username: user.username ?? null,
    email: user.email ?? null,
    globalPnl: user.pnl.toString(),
    totalVolume: user.totalVolume.toString(),
  };
}

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings/profile", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireCurrentUser(req, reply);
    if (!user) return;
    return reply.send(serializeProfile(user));
  });

  app.patch("/api/settings/profile", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    const user = await requireCurrentUser(req, reply);
    if (!user) return;
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const data: Partial<ProfileInput> = {};
    if (parsed.data.username !== undefined) data.username = parsed.data.username;
    if (parsed.data.email !== undefined) data.email = parsed.data.email;
    const prisma = getPrismaClient();
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { username: data.username ?? undefined, email: data.email ?? undefined },
    });
    return reply.send(serializeProfile(updated));
  });

  app.get("/api/settings/vault/balance", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await requireCurrentUser(req, reply);
    if (!user) return;
    const prisma = getPrismaClient();
    const vault = await prisma.userVault.findUnique({
      where: { userId: user.id },
    });
    const balance = vault?.balance?.toString() ?? "0";
    return reply.send({ balance });
  });

  app.post("/api/settings/vault/deposit", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    const user = await requireCurrentUser(req, reply);
    if (!user) return;
    const parsed = vaultAmountSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const prisma = getPrismaClient();
    const amount = parsed.data.amount;
    await prisma.userVault.upsert({
      where: { userId: user.id },
      create: { userId: user.id, balance: amount },
      update: { balance: { increment: amount } },
    });
    const vault = await prisma.userVault.findUnique({ where: { userId: user.id } });
    return reply.send({
      success: true,
      balance: vault?.balance?.toString() ?? amount,
    });
  });

  app.post("/api/settings/vault/withdraw", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    const user = await requireCurrentUser(req, reply);
    if (!user) return;
    const parsed = vaultAmountSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const prisma = getPrismaClient();
    const amount = parsed.data.amount;
    const vault = await prisma.userVault.findUnique({ where: { userId: user.id } });
    const current = vault?.balance?.toString() ?? "0";
    if (new Decimal(current).lt(new Decimal(amount))) {
      return reply.code(400).send({ error: "Insufficient balance" });
    }
    await prisma.userVault.upsert({
      where: { userId: user.id },
      create: { userId: user.id, balance: 0 },
      update: { balance: { decrement: amount } },
    });
    const updated = await prisma.userVault.findUnique({ where: { userId: user.id } });
    return reply.send({
      success: true,
      balance: updated?.balance?.toString() ?? "0",
    });
  });
}
