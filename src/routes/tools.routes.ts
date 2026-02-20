import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "../lib/prisma.js";
import {
  toolCreateSchema,
  toolUpdateSchema,
  toolQuerySchema,
  type ToolCreateInput,
  type ToolUpdateInput,
  type ToolQueryInput,
} from "../schemas/tool.schema.js";

function serializeTool(tool: {
  id: string;
  name: string;
  url: string;
  description: string;
  fee: { toString(): string };
  receiverAddress: string;
  inputSchema: unknown;
  outputSchema: unknown;
  provider: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...tool,
    fee: tool.fee.toString(),
  };
}

export async function registerToolRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/tools", async (req: FastifyRequest<{ Querystring: ToolQueryInput }>, reply: FastifyReply) => {
    const parsed = toolQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    const { provider, limit, offset } = parsed.data;
    const prisma = getPrismaClient();
    const where = provider ? { provider } : {};
    const [tools, total] = await Promise.all([
      prisma.tool.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      }),
      prisma.tool.count({ where }),
    ]);
    return reply.send({
      data: tools.map(serializeTool),
      total,
      limit,
      offset,
    });
  });

  app.get("/api/tools/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const prisma = getPrismaClient();
    const tool = await prisma.tool.findUnique({ where: { id: req.params.id } });
    if (!tool) return reply.code(404).send({ error: "Tool not found" });
    return reply.send(serializeTool(tool));
  });

  app.post("/api/tools", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    const parsed = toolCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const prisma = getPrismaClient();
    const tool = await prisma.tool.create({
      data: {
        ...parsed.data,
        inputSchema: parsed.data.inputSchema as object,
        outputSchema: parsed.data.outputSchema as object,
      },
    });
    return reply.code(201).send(serializeTool(tool));
  });

  app.patch("/api/tools/:id", async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply: FastifyReply) => {
    const parsed = toolUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const prisma = getPrismaClient();
    const raw = parsed.data;
    const data: Prisma.ToolUpdateInput = {};
    if (raw.name !== undefined) data.name = raw.name;
    if (raw.url !== undefined) data.url = raw.url;
    if (raw.description !== undefined) data.description = raw.description;
    if (raw.fee !== undefined) data.fee = raw.fee;
    if (raw.receiverAddress !== undefined) data.receiverAddress = raw.receiverAddress;
    if (raw.inputSchema !== undefined) data.inputSchema = raw.inputSchema as Prisma.InputJsonValue;
    if (raw.outputSchema !== undefined) data.outputSchema = raw.outputSchema as Prisma.InputJsonValue;
    if (raw.provider !== undefined) data.provider = raw.provider;
    const tool = await prisma.tool.update({
      where: { id: req.params.id },
      data,
    }).catch(() => null);
    if (!tool) return reply.code(404).send({ error: "Tool not found" });
    return reply.send(serializeTool(tool));
  });

  app.delete("/api/tools/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const prisma = getPrismaClient();
    await prisma.tool.delete({ where: { id: req.params.id } }).catch(() => null);
    return reply.code(204).send();
  });
}
