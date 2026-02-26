import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "../lib/prisma.js";
import { requireAgentOwnerOrApiKey, requireUserOrApiKey } from "../lib/permissions.js";
import { requireUser, requireApiKey } from "../lib/auth.js";
import { config } from "../config/index.js";
import { generateAgentKeys } from "../services/agent-keys.service.js";
import {
  agentCreateSchema,
  agentUpdateSchema,
  agentQuerySchema,
  agentPublicListSchema,
  CRE_PENDING_PUBLIC_KEY,
  CRE_PENDING_PRIVATE_KEY,
  type AgentCreateInput,
  type AgentUpdateInput,
  type AgentQueryInput,
  type AgentPublicListInput,
} from "../schemas/agent.schema.js";

const OPENCLAW_KEYS = [
  "soul",
  "persona",
  "skill",
  "methodology",
  "failed_tests",
  "context",
  "constraints",
] as const;

type OpenClawRow = {
  soul: string | null;
  persona: string | null;
  skill: string | null;
  methodology: string | null;
  failed_tests: string | null;
  context: string | null;
  constraints: string | null;
};

function openclawFromRow(row: OpenClawRow | null): Record<string, string> | undefined {
  if (!row) return undefined;
  const out: Record<string, string> = {};
  for (const k of OPENCLAW_KEYS) {
    const v = row[k];
    if (v != null && v !== "") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function modelSettingsWithOpenclaw(
  modelSettings: unknown,
  openclaw: OpenClawRow | null
): unknown {
  const base = typeof modelSettings === "object" && modelSettings !== null
    ? { ...(modelSettings as Record<string, unknown>) }
    : {};
  const merged = openclawFromRow(openclaw);
  if (merged) (base as Record<string, unknown>).openclaw = merged;
  return base;
}

/** True when agent can receive deposits and sign (has address and stored key). */
function hasCompleteWallet(
  walletAddress: string | null | undefined,
  encryptedPrivateKey: string | null | undefined
): boolean {
  const addr = walletAddress?.trim();
  const key = encryptedPrivateKey?.trim();
  return Boolean(
    addr &&
      addr !== CRE_PENDING_PUBLIC_KEY &&
      key &&
      key !== CRE_PENDING_PRIVATE_KEY
  );
}

/** Serialize agent for API display; omits encryptedPrivateKey; adds hasCompleteWallet; Decimal fields as string. */
function serializeAgent(agent: {
  id: string;
  ownerId: string;
  name: string;
  persona: string;
  publicKey: string;
  walletAddress?: string | null;
  balance: { toString(): string };
  tradedAmount: { toString(): string };
  totalTrades: number;
  pnl: { toString(): string };
  status: string;
  modelSettings: unknown;
  templateId: string | null;
  createdAt: Date;
  updatedAt: Date;
  currentExposure?: { toString(): string };
  maxDrawdown?: { toString(): string };
  winRate?: number;
  totalLlmTokens?: number;
  totalLlmCost?: { toString(): string };
} & { encryptedPrivateKey?: string }) {
  const { encryptedPrivateKey: enc, ...rest } = agent;
  const complete = hasCompleteWallet(agent.walletAddress ?? null, enc ?? null);
  return {
    ...rest,
    walletAddress: agent.walletAddress ?? null,
    balance: agent.balance.toString(),
    tradedAmount: agent.tradedAmount.toString(),
    pnl: agent.pnl.toString(),
    currentExposure: agent.currentExposure?.toString() ?? "0",
    maxDrawdown: agent.maxDrawdown?.toString() ?? "0",
    totalLlmCost: agent.totalLlmCost?.toString() ?? "0",
    hasCompleteWallet: complete,
  };
}

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/agents", async (req: FastifyRequest<{ Querystring: AgentQueryInput }>, reply: FastifyReply) => {
    if (!requireUserOrApiKey(req, reply)) return;
    const parsed = agentQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    const { ownerId, status, limit, offset } = parsed.data;
    const prisma = getPrismaClient();
    const isApiKey = requireApiKey(req);
    const effectiveOwnerId = isApiKey ? ownerId ?? null : requireUser(req)?.userId ?? null;
    if (effectiveOwnerId == null || effectiveOwnerId === "") {
      if (isApiKey) {
        return reply.code(403).send({ error: "Forbidden: must be owner or use API key to list agents" });
      }
      return reply.send({ data: [], total: 0, limit, offset });
    }
    const where = {
      ownerId: effectiveOwnerId,
      ...(status ? { status } : {}),
    };
    const [agents, total] = await Promise.all([
      prisma.agent.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: {
          owner: { select: { id: true, address: true } },
          strategy: true,
          template: { select: { id: true, name: true } },
          enqueuedMarkets: { select: { marketId: true } },
        },
      }),
      prisma.agent.count({ where }),
    ]);
    return reply.send({
      data: agents.map((a) => ({
        ...serializeAgent(a),
        owner: (a as { owner?: { address?: string } }).owner?.address ?? "",
        strategy: a.strategy,
        template: a.template,
        enqueuedMarketIds: a.enqueuedMarkets.map((m) => m.marketId),
      })),
      total,
      limit,
      offset,
    });
  });

  /** Public list: no auth; basic fields only (name, status, volume, trades, pnl, time). */
  app.get("/api/agents/public", async (req: FastifyRequest<{ Querystring: AgentPublicListInput }>, reply: FastifyReply) => {
    const parsed = agentPublicListSchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    const { status, limit, offset } = parsed.data;
    const prisma = getPrismaClient();
    const where = status ? { status } : {};
    const [agents, total] = await Promise.all([
      prisma.agent.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: [{ tradedAmount: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          name: true,
          status: true,
          tradedAmount: true,
          totalTrades: true,
          pnl: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.agent.count({ where }),
    ]);
    return reply.send({
      data: agents.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        volume: a.tradedAmount.toString(),
        trades: a.totalTrades,
        pnl: a.pnl.toString(),
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
      total,
      limit,
      offset,
    });
  });

  app.get("/api/agents/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!(await requireAgentOwnerOrApiKey(req, reply))) return;
    const prisma = getPrismaClient();
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      include: {
        owner: { select: { id: true, address: true } },
        strategy: true,
        template: { select: { id: true, name: true } },
        openclaw: true,
        enqueuedMarkets: { select: { marketId: true } },
      },
    });
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    const modelSettings = modelSettingsWithOpenclaw(agent.modelSettings, agent.openclaw);
    const payload = {
      ...serializeAgent(agent),
      modelSettings,
      owner: (agent as { owner?: { address?: string } }).owner?.address ?? "",
      strategy: agent.strategy,
      template: agent.template,
      enqueuedMarketIds: agent.enqueuedMarkets.map((m) => m.marketId),
    };
    return reply.send(payload);
  });

  /** Agent wallet status: balance and whether the agent has a complete wallet (address + key). Used for deposit and worker. */
  app.get("/api/agents/:id/wallet-status", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!(await requireAgentOwnerOrApiKey(req, reply))) return;
    const prisma = getPrismaClient();
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      select: { id: true, balance: true, walletAddress: true, publicKey: true, encryptedPrivateKey: true },
    });
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    const hasWallet = hasCompleteWallet(agent.walletAddress, agent.encryptedPrivateKey);
    return reply.send({
      balance: agent.balance.toString(),
      hasWallet,
    });
  });

  app.patch("/api/agents/:id", async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply: FastifyReply) => {
    if (!(await requireAgentOwnerOrApiKey(req, reply))) return;
    const parsed = agentUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const raw = parsed.data;
    const data: Prisma.AgentUpdateInput = {};
    if (raw.name !== undefined) data.name = raw.name;
    if (raw.persona !== undefined) data.persona = raw.persona;
    if (raw.encryptedPrivateKey !== undefined) data.encryptedPrivateKey = raw.encryptedPrivateKey;
    if (raw.status !== undefined) data.status = raw.status;
    if (raw.templateId !== undefined) {
      data.template = raw.templateId === null
        ? { disconnect: true }
        : { connect: { id: raw.templateId } };
    }
    let modelSettingsForDb = raw.modelSettings as Record<string, unknown> | undefined;
    const openclawPayload =
      modelSettingsForDb && typeof modelSettingsForDb.openclaw === "object" && modelSettingsForDb.openclaw !== null
        ? (modelSettingsForDb.openclaw as Record<string, unknown>)
        : undefined;
    if (openclawPayload !== undefined && modelSettingsForDb) {
      const rest = { ...modelSettingsForDb };
      delete rest.openclaw;
      modelSettingsForDb = Object.keys(rest).length > 0 ? rest : undefined;
    } else if (openclawPayload === undefined) {
      modelSettingsForDb = raw.modelSettings as Record<string, unknown> | undefined;
    }
    if (modelSettingsForDb !== undefined) data.modelSettings = modelSettingsForDb as Prisma.InputJsonValue;
    const prisma = getPrismaClient();
    const agentId = req.params.id;
    if (openclawPayload !== undefined) {
      const openclawData: Record<string, string | null> = {};
      for (const k of OPENCLAW_KEYS) {
        const v = openclawPayload[k];
        openclawData[k] =
          typeof v === "string" ? v : v == null ? null : String(v);
      }
      await prisma.agentOpenClaw.upsert({
        where: { agentId },
        create: { agentId, ...openclawData },
        update: openclawData,
      });
    }
    const agent = await prisma.agent
      .update({
        where: { id: agentId },
        data,
        include: {
          owner: { select: { id: true, address: true } },
          strategy: true,
          template: { select: { id: true, name: true } },
          openclaw: true,
        },
      })
      .catch(() => null);
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    const modelSettings = modelSettingsWithOpenclaw(agent.modelSettings, agent.openclaw);
    return reply.send({
      ...serializeAgent(agent),
      modelSettings,
      owner: (agent as { owner?: { address?: string } }).owner?.address ?? "",
      strategy: agent.strategy,
      template: agent.template,
    });
  });

  /** Create agent wallet via CRE (createAgentKey). CRE generates the key and stores it in confidential compute;
   * we only store the returned address. The agent uses CRE (e.g. quote/order) when it needs to sign transactions. */
  app.post("/api/agents/:id/create-wallet", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!(await requireAgentOwnerOrApiKey(req, reply))) return;
    const agentId = req.params.id;
    const prisma = getPrismaClient();
    const existing = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, walletAddress: true, encryptedPrivateKey: true, owner: { select: { id: true, address: true } }, strategy: true, template: { select: { id: true, name: true } }, openclaw: true, modelSettings: true, balance: true, tradedAmount: true, totalTrades: true, pnl: true, status: true, currentExposure: true, maxDrawdown: true, winRate: true, totalLlmTokens: true, totalLlmCost: true, ownerId: true, name: true, persona: true, publicKey: true, templateId: true, createdAt: true, updatedAt: true },
    });
    if (!existing) return reply.code(404).send({ error: "Agent not found" });
    if (hasCompleteWallet(existing.walletAddress, existing.encryptedPrivateKey)) {
      const modelSettings = modelSettingsWithOpenclaw(existing.modelSettings, existing.openclaw);
      return reply.send({
        ...serializeAgent(existing),
        modelSettings,
        owner: (existing as { owner?: { address?: string } }).owner?.address ?? "",
        strategy: existing.strategy,
        template: existing.template,
      });
    }
    let updateData: { walletAddress: string; publicKey?: string; encryptedPrivateKey?: string };
    const creUrl = config.creHttpUrl;
    if (creUrl) {
      const body: Record<string, unknown> = { action: "createAgentKey", agentId };
      if (config.creHttpApiKey) body.apiKey = config.creHttpApiKey;
      let res: Response;
      try {
        res = await fetch(creUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (err) {
        return reply.code(502).send({ error: "CRE request failed", detail: err instanceof Error ? err.message : "Unknown error" });
      }
      const text = await res.text();
      if (!res.ok) {
        return reply.code(502).send({ error: "CRE returned error", detail: text || String(res.status) });
      }
      let data: { address?: string; encryptedKeyBlob?: string };
      try {
        data = JSON.parse(text) as { address?: string; encryptedKeyBlob?: string };
      } catch {
        return reply.code(502).send({ error: "CRE response invalid", detail: text });
      }
      const address = typeof data.address === "string" ? data.address.trim() : "";
      if (address && address.startsWith("0x")) {
        const creBlob = typeof data.encryptedKeyBlob === "string" ? data.encryptedKeyBlob.trim() : "";
        if (creBlob.length > 0) {
          updateData = { walletAddress: address, encryptedPrivateKey: creBlob };
          if (existing.publicKey === CRE_PENDING_PUBLIC_KEY) updateData.publicKey = address;
        } else {
          /* CRE returned address but empty encryptedKeyBlob (e.g. simulation or workflow not returning blob): use server-generated keys so agent can sign. */
          const keys = generateAgentKeys();
          updateData = {
            walletAddress: keys.publicKey,
            encryptedPrivateKey: keys.encryptedPrivateKey,
          };
          if (existing.publicKey === CRE_PENDING_PUBLIC_KEY) updateData.publicKey = keys.publicKey;
        }
      } else {
        const keys = generateAgentKeys();
        updateData = {
          walletAddress: keys.publicKey,
          encryptedPrivateKey: keys.encryptedPrivateKey,
        };
        if (existing.publicKey === CRE_PENDING_PUBLIC_KEY) updateData.publicKey = keys.publicKey;
      }
    } else {
      /* CRE not configured: create wallet with server-generated keys */
      const keys = generateAgentKeys();
      updateData = {
        walletAddress: keys.publicKey,
        encryptedPrivateKey: keys.encryptedPrivateKey,
      };
      if (existing.publicKey === CRE_PENDING_PUBLIC_KEY) updateData.publicKey = keys.publicKey;
    }

    const agent = await prisma.agent.update({
      where: { id: agentId },
      data: updateData,
      include: {
        owner: { select: { id: true, address: true } },
        strategy: true,
        template: { select: { id: true, name: true } },
        openclaw: true,
      },
    });
    const modelSettings = modelSettingsWithOpenclaw(agent.modelSettings, agent.openclaw);
    return reply.send({
      ...serializeAgent(agent),
      modelSettings,
      owner: (agent as { owner?: { address?: string } }).owner?.address ?? "",
      strategy: agent.strategy,
      template: agent.template,
    });
  });

  app.get("/api/agents/:id/tracks", async (req: FastifyRequest<{ Params: { id: string }; Querystring: { limit?: string; from?: string; to?: string } }>, reply: FastifyReply) => {
    if (!(await requireAgentOwnerOrApiKey(req, reply))) return;
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 90), 365);
    const from = req.query.from ? new Date(req.query.from) : undefined;
    const to = req.query.to ? new Date(req.query.to) : undefined;
    const prisma = getPrismaClient();
    const where: { agentId: string; date?: { gte?: Date; lte?: Date } } = { agentId: req.params.id };
    if (from ?? to) {
      where.date = {};
      if (from) where.date.gte = from;
      if (to) where.date.lte = to;
    }
    const tracks = await prisma.agentTrack.findMany({
      where,
      orderBy: { date: "asc" },
      take: limit,
    });
    type TrackRow = typeof tracks[0] & {
      exposure?: { toString(): string };
      drawdown?: { toString(): string };
      llmTokensUsed?: number;
      llmCost?: { toString(): string };
    };
    return reply.send({
      data: tracks.map((t) => {
        const row = t as TrackRow;
        return {
          id: row.id,
          agentId: row.agentId,
          date: row.date.toISOString().slice(0, 10),
          volume: row.volume.toString(),
          trades: row.trades,
          pnl: row.pnl.toString(),
          exposure: row.exposure?.toString() ?? "0",
          drawdown: row.drawdown?.toString() ?? "0",
          llmTokensUsed: row.llmTokensUsed ?? 0,
          llmCost: row.llmCost?.toString() ?? "0",
          createdAt: row.createdAt.toISOString(),
        };
      }),
    });
  });

  app.get("/api/agents/:id/reasoning", async (req: FastifyRequest<{ Params: { id: string }; Querystring: { limit?: string; offset?: string } }>, reply: FastifyReply) => {
    if (!(await requireAgentOwnerOrApiKey(req, reply))) return;
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 100);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const prisma = getPrismaClient();
    const repo = (prisma as unknown as { agentReasoning: { findMany: typeof prisma.agentTrack.findMany; count: typeof prisma.agentTrack.count } }).agentReasoning;
    const [items, total] = await Promise.all([
      repo.findMany({
        where: { agentId: req.params.id },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      repo.count({ where: { agentId: req.params.id } }),
    ]);
    type ReasonRow = { estimatedCost?: { toString(): string }; createdAt: Date; [k: string]: unknown };
    return reply.send({
      data: items.map((r: ReasonRow) => ({
        ...r,
        estimatedCost: r.estimatedCost?.toString() ?? "0",
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      limit,
      offset,
    });
  });

  app.post("/api/agents", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    if (!requireUserOrApiKey(req, reply)) return;
    const parsed = agentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    if (!requireApiKey(req)) {
      const user = requireUser(req);
      if (!user?.userId) return reply.code(403).send({ error: "User not found or not registered" });
      if (parsed.data.ownerId !== user.userId) return reply.code(403).send({ error: "Forbidden: can only create agent for yourself" });
    }
    const prisma = getPrismaClient();
    const owner = await prisma.user.findUnique({ where: { id: parsed.data.ownerId } });
    if (!owner) return reply.code(404).send({ error: "Owner not found" });
    const publicKey = parsed.data.publicKey?.trim() ?? CRE_PENDING_PUBLIC_KEY;
    const encryptedPrivateKey = parsed.data.encryptedPrivateKey?.trim() ?? CRE_PENDING_PRIVATE_KEY;
    let agent = await prisma.agent.create({
      data: {
        ownerId: parsed.data.ownerId,
        name: parsed.data.name,
        persona: parsed.data.persona,
        publicKey,
        encryptedPrivateKey,
        modelSettings: parsed.data.modelSettings as Prisma.InputJsonValue,
        templateId: parsed.data.templateId ?? undefined,
      },
      include: { owner: { select: { id: true, address: true } } },
    });

    if (publicKey === CRE_PENDING_PUBLIC_KEY || encryptedPrivateKey === CRE_PENDING_PRIVATE_KEY) {
      const keys = generateAgentKeys();
      agent = await prisma.agent.update({
        where: { id: agent.id },
        data: {
          walletAddress: keys.publicKey,
          publicKey: keys.publicKey,
          encryptedPrivateKey: keys.encryptedPrivateKey,
        },
        include: { owner: { select: { id: true, address: true } } },
      });
    }

    return reply.code(201).send({ ...serializeAgent(agent), owner: (agent as { owner?: { address?: string } }).owner?.address ?? "" });
  });

  app.delete("/api/agents/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!(await requireAgentOwnerOrApiKey(req, reply))) return;
    const prisma = getPrismaClient();
    await prisma.agent.delete({ where: { id: req.params.id } }).catch(() => null);
    return reply.code(204).send();
  });
}
