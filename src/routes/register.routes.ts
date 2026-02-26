import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "../lib/prisma.js";
import { requireUser, getJwtFromRequest } from "../lib/auth.js";
import { generateAgentKeys } from "../services/agent-keys.service.js";
import {
  usernameCheckSchema,
  registerBodySchema,
} from "../schemas/register.schema.js";

function serializeUser(user: { id: string; username: string | null; address: string; email: string | null; authMethod: string | null; totalVolume: { toString(): string }; pnl: { toString(): string }; createdAt: Date; updatedAt: Date }) {
  return {
    ...user,
    totalVolume: user.totalVolume.toString(),
    pnl: user.pnl.toString(),
  };
}

export async function registerRegisterRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/register/username/available", async (req: FastifyRequest<{ Querystring: { username?: string } }>, reply: FastifyReply) => {
    const parsed = usernameCheckSchema.safeParse({ username: req.query.username ?? "" });
    if (!parsed.success) {
      return reply.code(400).send({ available: false, error: "Invalid username", details: parsed.error.flatten() });
    }
    const prisma = getPrismaClient();
    const existing = await prisma.user.findUnique({ where: { username: parsed.data.username } });
    return reply.send({ available: existing === null, username: parsed.data.username });
  });

  app.post("/api/register", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    const userAuth = requireUser(req);
    if (!userAuth) {
      const hadJwt = getJwtFromRequest(req) !== null;
      const message = hadJwt
        ? "Session invalid or expired. Ensure backend AUTH_DOMAIN matches your app origin (e.g. localhost:3002) and send the JWT in Authorization: Bearer header for cross-origin requests. Sign in again."
        : "Authentication required. Sign in with your wallet (Thirdweb).";
      return reply.code(401).send({ error: message });
    }

    const parsed = registerBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const body = parsed.data;
    const address = userAuth.address;

    const prisma = getPrismaClient();
    const [existingUserByAddress, existingUserByUsername] = await Promise.all([
      prisma.user.findUnique({ where: { address } }),
      prisma.user.findUnique({ where: { username: body.username } }),
    ]);
    if (existingUserByAddress) {
      return reply.code(409).send({ error: "Address already registered" });
    }
    if (existingUserByUsername) {
      return reply.code(409).send({ error: "Username already taken" });
    }

    const keys = generateAgentKeys();

    let agentData: Prisma.AgentCreateWithoutOwnerInput;
    if ("template" in body.agent) {
      const template = await prisma.template.findUnique({ where: { id: body.agent.template.templateId } });
      if (!template) {
        return reply.code(404).send({ error: "Template not found" });
      }
      const t = body.agent.template;
      agentData = {
        name: t.name.trim(),
        persona: (t.persona ?? t.name).trim(),
        publicKey: keys.publicKey,
        walletAddress: keys.publicKey,
        encryptedPrivateKey: keys.encryptedPrivateKey,
        modelSettings: (t.modelSettings ?? {}) as Prisma.InputJsonValue,
        template: { connect: { id: t.templateId } },
      };
    } else {
      const c = body.agent.create;
      agentData = {
        name: c.name.trim(),
        persona: (c.persona ?? c.name).trim(),
        publicKey: keys.publicKey,
        walletAddress: keys.publicKey,
        encryptedPrivateKey: keys.encryptedPrivateKey,
        modelSettings: (c.modelSettings ?? {}) as Prisma.InputJsonValue,
      };
    }

    const user = await prisma.user.create({
      data: {
        username: body.username,
        address,
        ...(body.email !== undefined && body.email !== null ? { email: body.email } : {}),
        authMethod: body.authMethod,
        agents: {
          create: agentData,
        },
      },
      include: { agents: { take: 1 } },
    });

    const agent = user.agents[0];
    return reply.code(201).send({
      user: serializeUser(user),
      agent: agent
        ? {
            id: agent.id,
            name: agent.name,
            status: agent.status,
            templateId: agent.templateId,
          }
        : null,
    });
  });
}
