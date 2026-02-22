import { getPrismaClient } from "../lib/prisma.js";
import type {
  ActivityItem,
  ActivityPayload,
  ActivityType,
  ActivitiesQuery,
  HolderSummary,
  TraderSummary,
} from "../types/activities.js";
import { ACTIVITY_TYPES } from "../types/activities.js";

const DEFAULT_TYPES: ActivityType[] = ["trade", "position", "news", "agent_activity"];
const MAX_ITEMS_PER_TYPE = 500;

function parseTypesParam(typesStr: string | undefined): ActivityType[] {
  if (!typesStr?.trim()) return DEFAULT_TYPES;
  const requested = typesStr.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const allowed = new Set(ACTIVITY_TYPES);
  const filtered = requested.filter((t) => allowed.has(t as ActivityType));
  return filtered.length > 0 ? (filtered as ActivityType[]) : DEFAULT_TYPES;
}

export async function getActivities(query: ActivitiesQuery): Promise<{
  data: ActivityItem[];
  total: number;
  limit: number;
  offset: number;
}> {
  const types = Array.isArray(query.types)
    ? (query.types.length > 0 ? query.types : DEFAULT_TYPES)
    : parseTypesParam(query.types as string | undefined);
  const prisma = getPrismaClient();
  const { marketId, userId, agentId, positionId, limit, offset } = query;

  const items: ActivityItem[] = [];

  if (types.includes("trade")) {
    const where = {
      ...(marketId ? { marketId } : {}),
      ...(userId ? { userId } : {}),
      ...(agentId ? { agentId } : {}),
    };
    const trades = await prisma.trade.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: "desc" },
      take: MAX_ITEMS_PER_TYPE,
      include: { market: { select: { id: true } } },
    });
    for (const t of trades) {
      items.push({
        id: t.id,
        type: "trade",
        createdAt: t.createdAt.toISOString(),
        payload: {
          type: "trade",
          id: t.id,
          marketId: t.marketId,
          outcomeIndex: t.outcomeIndex,
          userId: t.userId,
          agentId: t.agentId,
          side: t.side,
          amount: t.amount.toString(),
          price: t.price.toString(),
          txHash: t.txHash,
          createdAt: t.createdAt.toISOString(),
        } as ActivityPayload,
      });
    }
  }

  if (types.includes("position")) {
    const where: { marketId?: string; userId?: string; agentId?: string; id?: string } = {
      ...(marketId ? { marketId } : {}),
      ...(userId ? { userId } : {}),
      ...(agentId ? { agentId } : {}),
      ...(positionId ? { id: positionId } : {}),
    };
    const positions = await prisma.position.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: "desc" },
      take: MAX_ITEMS_PER_TYPE,
    });
    for (const p of positions) {
      items.push({
        id: p.id,
        type: "position",
        createdAt: p.createdAt.toISOString(),
        payload: {
          type: "position",
          id: p.id,
          marketId: p.marketId,
          userId: p.userId,
          agentId: p.agentId,
          address: p.address,
          side: p.side,
          status: p.status,
          avgPrice: p.avgPrice.toString(),
          collateralLocked: p.collateralLocked.toString(),
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        } as ActivityPayload,
      });
    }
  }

  if (types.includes("news")) {
    const where = marketId ? { marketId } : {};
    const news = await prisma.news.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: "desc" },
      take: MAX_ITEMS_PER_TYPE,
    });
    for (const n of news) {
      const row = n as typeof n & { imageUrl?: string | null };
      items.push({
        id: n.id,
        type: "news",
        createdAt: n.createdAt.toISOString(),
        payload: {
          type: "news",
          id: n.id,
          marketId: n.marketId,
          title: n.title,
          body: n.body,
          imageUrl: row.imageUrl ?? null,
          sourceUrl: n.sourceUrl ?? null,
          createdAt: n.createdAt.toISOString(),
        } as ActivityPayload,
      });
    }
  }

  if (types.includes("agent_activity")) {
    const where = agentId ? { agentId } : {};
    const activities = await prisma.activity.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: "desc" },
      take: MAX_ITEMS_PER_TYPE,
    });
    for (const a of activities) {
      items.push({
        id: a.id,
        type: "agent_activity",
        createdAt: a.createdAt.toISOString(),
        payload: {
          type: "agent_activity",
          id: a.id,
          agentId: a.agentId,
          activityType: a.type,
          payload: a.payload,
          createdAt: a.createdAt.toISOString(),
        } as ActivityPayload,
      });
    }
  }

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const total = items.length;
  const data = items.slice(offset, offset + limit);

  return { data, total, limit, offset };
}

export async function getMarketHolders(marketId: string): Promise<HolderSummary[]> {
  const prisma = getPrismaClient();
  const positions = await prisma.position.findMany({
    where: { marketId },
    select: { userId: true, agentId: true, address: true, status: true },
  });
  const byKey = new Map<string, { userId: string | null; agentId: string | null; address: string; open: number; total: number }>();
  for (const p of positions) {
    const key = `${p.userId ?? ""}:${p.agentId ?? ""}:${p.address}`;
    const cur = byKey.get(key) ?? {
      userId: p.userId,
      agentId: p.agentId,
      address: p.address,
      open: 0,
      total: 0,
    };
    cur.total += 1;
    if (p.status === "OPEN") cur.open += 1;
    byKey.set(key, cur);
  }
  return Array.from(byKey.values()).map((v) => ({
    userId: v.userId,
    agentId: v.agentId,
    address: v.address,
    positionCount: v.total,
    openPositionCount: v.open,
  }));
}

export async function getMarketTraders(marketId: string): Promise<TraderSummary[]> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRaw<
    { user_id: string | null; agent_id: string | null; trade_count: bigint; total_volume: unknown }[]
  >`
    SELECT t."userId" as user_id, t."agentId" as agent_id,
           COUNT(*)::bigint as trade_count,
           COALESCE(SUM(t.amount * t.price), 0)::decimal as total_volume
    FROM "Trade" t
    WHERE t."marketId" = ${marketId}
    GROUP BY t."userId", t."agentId"
  `;
  return rows.map((r) => ({
    userId: r.user_id,
    agentId: r.agent_id,
    tradeCount: Number(r.trade_count),
    totalVolume: String(r.total_volume),
  }));
}
