import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "../lib/prisma.js";
import { recoverAddressFromSignature, normalizeAddress } from "../lib/verify-signature.js";
import { createChallenge, consumeNonce, getNonceAddress } from "../services/challenge.service.js";
import {
  usernameCheckSchema,
  challengeBodySchema,
  registerBodySchema,
  type UsernameCheckInput,
  type ChallengeBodyInput,
  type RegisterBodyInput,
} from "../schemas/register.schema.js";

function ensureHexSignature(sig: string): `0x${string}` {
  return sig.startsWith("0x") ? (sig as `0x${string}`) : (`0x${sig}` as `0x${string}`);
}

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

  app.post("/api/register/challenge", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    const parsed = challengeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const address = normalizeAddress(parsed.data.address);
    const challenge = await createChallenge(address);
    return reply.send(challenge);
  });

  app.post("/api/register", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    const parsed = registerBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }

    const body = parsed.data;
    const address = normalizeAddress(body.address);
    const sig = ensureHexSignature(body.verificationSignature);

    const recovered = await recoverAddressFromSignature(body.verificationMessage, sig);
    if (recovered === null) {
      return reply.code(400).send({ error: "Invalid signature: could not recover address" });
    }
    if (recovered !== address) {
      return reply.code(400).send({ error: "Signature address does not match provided address" });
    }

    const nonceAddress = await getNonceAddress(body.nonce);
    if (nonceAddress === null) {
      return reply.code(400).send({ error: "Invalid or expired nonce. Request a new challenge." });
    }
    if (nonceAddress.toLowerCase() !== address) {
      return reply.code(400).send({ error: "Nonce was issued for a different address" });
    }

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

    const consumed = await consumeNonce(body.nonce);
    if (consumed === null) {
      return reply.code(400).send({ error: "Nonce already used or expired" });
    }

    let agentData: Prisma.AgentCreateWithoutOwnerInput;
    if ("template" in body.agent) {
      const template = await prisma.template.findUnique({ where: { id: body.agent.template.templateId } });
      if (!template) {
        return reply.code(404).send({ error: "Template not found" });
      }
      const t = body.agent.template;
      agentData = {
        name: t.name,
        persona: t.persona ?? t.name,
        publicKey: t.publicKey,
        encryptedPrivateKey: t.encryptedPrivateKey,
        modelSettings: (t.modelSettings ?? {}) as Prisma.InputJsonValue,
        template: { connect: { id: t.templateId } },
      };
    } else {
      const c = body.agent.create;
      agentData = {
        name: c.name,
        persona: c.persona,
        publicKey: c.publicKey,
        encryptedPrivateKey: c.encryptedPrivateKey,
        modelSettings: c.modelSettings as Prisma.InputJsonValue,
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
