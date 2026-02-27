import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { getPrismaClient } from "../lib/prisma.js";

const feedQuerySchema = z.object({
  /** Filter by tickers (e.g. BTC,ETH). Omit for all. */
  currencies: z.string().optional().transform((s) =>
    s ? s.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean) : undefined
  ),
  /** Max items (default 50, max 100). */
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  /** Source filter: RSS_COINDESK, RSS_COINTELEGRAPH, CRYPTOPANIC. Omit for all. */
  source: z.string().optional(),
});

type FeedQueryInput = z.infer<typeof feedQuerySchema>;

function serializeFeedItem(item: {
  id: string;
  source: string;
  externalId: string;
  title: string;
  body: string | null;
  sourceUrl: string | null;
  imageUrl: string | null;
  publishedAt: Date;
  metadata: unknown;
  createdAt: Date;
}) {
  return {
    id: item.id,
    source: item.source,
    externalId: item.externalId,
    title: item.title,
    body: item.body,
    sourceUrl: item.sourceUrl,
    imageUrl: item.imageUrl,
    publishedAt: item.publishedAt.toISOString(),
    metadata: item.metadata,
    createdAt: item.createdAt.toISOString(),
  };
}

export async function registerFeedRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/feed", async (req: FastifyRequest<{ Querystring: unknown }>, reply: FastifyReply) => {
    const parsed = feedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    const { currencies, limit, source } = parsed.data as FeedQueryInput;
    const prisma = getPrismaClient();

    const where: { source?: string } = {};
    if (source) where.source = source;
    const items = await prisma.feedItem.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { publishedAt: "desc" },
      take: limit * 2,
    });

    const filtered =
      currencies != null && currencies.length > 0
        ? items.filter((it) => {
            const meta = it.metadata as { currencies?: string[] } | null;
            const list = meta?.currencies ?? [];
            if (list.length > 0) return currencies.some((c) => list.includes(c));
            const text = `${it.title} ${it.body ?? ""}`.toUpperCase();
            return currencies.some((c) => text.includes(c));
          })
        : items;

    return reply.send({
      data: filtered.slice(0, limit).map(serializeFeedItem),
    });
  });
}
