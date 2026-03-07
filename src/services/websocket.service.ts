import type { WebSocket } from "ws";
import type { FastifyRequest } from "fastify";
import { HEARTBEAT_INTERVAL_MS, REDIS_CHANNELS, ROOM_PREFIX } from "../config/index.js";
import { WS_EVENT_NAMES } from "../types/websocket-events.js";
import {
  wsMessageSchema,
  subscribeMessageSchema,
  unsubscribeMessageSchema,
} from "../schemas/websocket.schema.js";
import type {
  WsMessage,
  WsEventName,
  OrderBookUpdatePayload,
  MarketUpdatedPayload,
  AgentUpdatedPayload,
  ActivityLogPayload,
  PositionUpdatedPayload,
  UserAssetChangedPayload,
  AIAnalysisUpdatePayload,
  AgentMarketActionPayload,
  LMSRPricingUpdatePayload,
  CrePayloadForFrontend,
} from "../types/websocket-events.js";
import { getRedisPublisher, getRedisSubscriber } from "../lib/redis.js";

const BROADCAST_CHANNEL = "ws:broadcast";

/** Strip sensitive fields (userSignature, conditionId) from crePayload before sending to frontend. */
function sanitizeCrePayloadForFrontend(p: Record<string, unknown>): CrePayloadForFrontend {
  const { userSignature, conditionId, ...rest } = p;
  return rest as CrePayloadForFrontend;
}

interface SocketMeta {
  lastPongAt: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
}

interface RoomFilters {
  eventTypes?: WsEventName[];
  userScoped?: boolean;
  agentId?: string;
}

interface RoomSubscription {
  room: string;
  filters?: RoomFilters;
}

export class SocketManager {
  private static instance: SocketManager | null = null;
  private readonly rooms = new Map<string, Set<WebSocket>>();
  private readonly socketToRooms = new Map<WebSocket, Set<string>>();
  private readonly roomFilters = new Map<WebSocket, Map<string, RoomFilters>>();
  private readonly socketMeta = new Map<WebSocket, SocketMeta>();
  private readonly socketUserId = new Map<WebSocket, string | null>();
  private redisSub: Awaited<ReturnType<typeof getRedisSubscriber>> | null = null;
  private subscribeRedisPromise: Promise<void> | null = null;

  static getInstance(): SocketManager {
    if (SocketManager.instance === null) {
      SocketManager.instance = new SocketManager();
    }
    return SocketManager.instance;
  }

  async start(): Promise<void> {
    if (this.subscribeRedisPromise !== null) return this.subscribeRedisPromise;
    this.subscribeRedisPromise = this.subscribeRedis();
    return this.subscribeRedisPromise;
  }

  private async subscribeRedis(): Promise<void> {
    try {
      const sub = await getRedisSubscriber();
      this.redisSub = sub;
      await sub.subscribe(
        BROADCAST_CHANNEL,
        REDIS_CHANNELS.ORDER_BOOK_UPDATE,
        REDIS_CHANNELS.TRADES,
        REDIS_CHANNELS.MARKET_UPDATES,
        REDIS_CHANNELS.AGENT_UPDATES,
        REDIS_CHANNELS.ACTIVITY_LOG,
        REDIS_CHANNELS.POSITION_UPDATES,
        REDIS_CHANNELS.USER_ASSET_CHANGES,
        REDIS_CHANNELS.AI_ANALYSIS,
        REDIS_CHANNELS.AGENT_MARKET_ACTIONS,
        REDIS_CHANNELS.LMSR_PRICING,
        REDIS_CHANNELS.ORDER_CRE_PAYLOAD
      );
      sub.on("message", (channel: string, message: string) => {
      try {
        if (channel === BROADCAST_CHANNEL) {
          const { room, payload, filters } = JSON.parse(message) as {
            room: string;
            payload: WsMessage<WsEventName>;
            filters?: RoomFilters;
          };
          this.broadcastToLocalRoom(room, payload, filters);
          return;
        }
        if (channel === REDIS_CHANNELS.ORDER_BOOK_UPDATE) {
          const { marketId, outcomeIndex, snapshot } = JSON.parse(message) as {
            marketId: string;
            outcomeIndex: number;
            snapshot: OrderBookUpdatePayload;
          };
          const room = `${ROOM_PREFIX}${marketId}`;
          this.broadcastToLocalRoom(room, {
            type: WS_EVENT_NAMES.ORDER_BOOK_UPDATE,
            payload: { ...snapshot, marketId, outcomeIndex: outcomeIndex ?? snapshot.outcomeIndex },
          });
          return;
        }
        if (channel === REDIS_CHANNELS.TRADES) {
          const parsed = JSON.parse(message) as {
            trade: { id?: string; marketId: string; outcomeIndex?: number; side: string; quantity: string; price: string; executedAt: number; userId?: string; agentId?: string };
            orderId?: string;
            crePayload?: Record<string, unknown>;
            txHash?: string;
          };
          const { trade, orderId, crePayload: rawCrePayload, txHash: msgTxHash } = parsed;
          const room = `${ROOM_PREFIX}${trade.marketId}`;
          const crePayload = rawCrePayload != null ? sanitizeCrePayloadForFrontend(rawCrePayload) : undefined;
          const txHash = msgTxHash ?? (crePayload && "txHash" in crePayload ? (crePayload as { txHash?: string }).txHash : undefined);
          this.broadcastToLocalRoom(room, {
            type: WS_EVENT_NAMES.TRADE_EXECUTED,
            payload: {
              tradeId: trade.id ?? orderId ?? "",
              marketId: trade.marketId,
              outcomeIndex: trade.outcomeIndex,
              side: trade.side === "BID" ? "long" : "short",
              size: trade.quantity,
              price: trade.price,
              executedAt: new Date(trade.executedAt).toISOString(),
              userId: trade.userId,
              agentId: trade.agentId,
              ...(txHash != null ? { txHash } : {}),
              ...(crePayload != null ? { crePayload } : {}),
            },
          });
          return;
        }
        if (channel === REDIS_CHANNELS.ORDER_CRE_PAYLOAD) {
          const raw = JSON.parse(message) as {
            orderId: string;
            marketId: string;
            outcomeIndex?: number;
            side?: "BID" | "ASK";
            crePayload: Record<string, unknown>;
          };
          const room = `${ROOM_PREFIX}${raw.marketId}`;
          const crePayload = sanitizeCrePayloadForFrontend(raw.crePayload);
          this.broadcastToLocalRoom(room, {
            type: WS_EVENT_NAMES.ORDER_CRE_PAYLOAD,
            payload: {
              orderId: raw.orderId,
              marketId: raw.marketId,
              outcomeIndex: raw.outcomeIndex,
              side: raw.side,
              crePayload,
            },
          });
          return;
        }
        if (channel === REDIS_CHANNELS.MARKET_UPDATES) {
          const raw = JSON.parse(message) as {
            marketId: string;
            reason?: string;
            volume?: string;
            liquidity?: string;
            probability?: number;
            status?: string;
          };
          const reason = raw.reason ?? (raw.volume != null ? "stats" : undefined);
          const payload: MarketUpdatedPayload = {
            marketId: raw.marketId,
            reason:
              reason === "created" ||
                reason === "updated" ||
                reason === "deleted" ||
                reason === "stats" ||
                reason === "position" ||
                reason === "orderbook" ||
                reason === "liquidity" ||
                reason === "resolved"
                ? reason
                : undefined,
            volume: raw.volume,
            liquidity: raw.liquidity,
            probability: raw.probability,
            status: raw.status,
          };
          const msg: WsMessage<WsEventName> = {
            type: WS_EVENT_NAMES.MARKET_UPDATED,
            payload,
          };
          const room = `${ROOM_PREFIX}${raw.marketId}`;
          this.broadcastToLocalRoom(room, msg);
          if (payload.reason === "created" || payload.reason === "deleted") {
            this.broadcastToLocalRoom("markets", msg);
          }
          return;
        }
        if (channel === REDIS_CHANNELS.AGENT_UPDATES) {
          const raw = JSON.parse(message) as { agentId: string; marketId?: string; balance?: string; pnl?: string; activePositions?: number; reason?: string };
          const payload: AgentUpdatedPayload = {
            agentId: raw.agentId,
            marketId: raw.marketId,
            balance: raw.balance,
            pnl: raw.pnl,
            activePositions: raw.activePositions,
            reason: raw.reason === "balance" || raw.reason === "position" || raw.reason === "market_action" || raw.reason === "sync" ? raw.reason : undefined,
          };
          const msg: WsMessage<WsEventName> = {
            type: WS_EVENT_NAMES.AGENT_UPDATED,
            payload,
          };
          // Broadcast to global agent room
          this.broadcastToLocalRoom(`agent:${raw.agentId}`, msg);
          // Also broadcast to market-specific agent room if marketId is present
          if (raw.marketId) {
            this.broadcastToLocalRoom(`${ROOM_PREFIX}${raw.marketId}:agent:${raw.agentId}`, msg);
          }
          return;
        }
        // Enhanced channels
        if (channel === REDIS_CHANNELS.ACTIVITY_LOG) {
          const { activity, room } = JSON.parse(message) as { activity: ActivityLogPayload; room?: string };
          const msg: WsMessage<WsEventName> = {
            type: WS_EVENT_NAMES.ACTIVITY_LOG,
            payload: activity,
          };
          const targetRoom = room ?? `${ROOM_PREFIX}${activity.marketId}:activity`;
          this.broadcastToLocalRoom(targetRoom, msg);
          // Also broadcast to main market room
          this.broadcastToLocalRoom(`${ROOM_PREFIX}${activity.marketId}`, msg);
          return;
        }
        if (channel === REDIS_CHANNELS.POSITION_UPDATES) {
          const { position } = JSON.parse(message) as { position: PositionUpdatedPayload };
          const msg: WsMessage<WsEventName> = {
            type: WS_EVENT_NAMES.POSITION_UPDATED,
            payload: position,
          };
          // Broadcast to market room
          this.broadcastToLocalRoom(`${ROOM_PREFIX}${position.marketId}`, msg);
          // Broadcast to user-scoped room if userId present
          if (position.userId) {
            this.broadcastToLocalRoom(`${ROOM_PREFIX}${position.marketId}:user:${position.userId}`, msg);
          }
          // Broadcast to agent-scoped room if agentId present
          if (position.agentId) {
            this.broadcastToLocalRoom(`${ROOM_PREFIX}${position.marketId}:agent:${position.agentId}`, msg);
          }
          return;
        }
        if (channel === REDIS_CHANNELS.USER_ASSET_CHANGES) {
          const { asset } = JSON.parse(message) as { asset: UserAssetChangedPayload };
          const msg: WsMessage<WsEventName> = {
            type: WS_EVENT_NAMES.USER_ASSET_CHANGED,
            payload: asset,
          };
          // Only broadcast to user-scoped room
          this.broadcastToLocalRoom(`${ROOM_PREFIX}${asset.marketId}:user:${asset.userId}`, msg);
          return;
        }
        if (channel === REDIS_CHANNELS.AI_ANALYSIS) {
          const { analysis } = JSON.parse(message) as { analysis: AIAnalysisUpdatePayload };
          const msg: WsMessage<WsEventName> = {
            type: WS_EVENT_NAMES.AI_ANALYSIS_UPDATE,
            payload: analysis,
          };
          // Broadcast to AI-specific room
          this.broadcastToLocalRoom(`${ROOM_PREFIX}${analysis.marketId}:ai`, msg);
          // Also broadcast to main market room
          this.broadcastToLocalRoom(`${ROOM_PREFIX}${analysis.marketId}`, msg);
          return;
        }
        if (channel === REDIS_CHANNELS.AGENT_MARKET_ACTIONS) {
          const { action } = JSON.parse(message) as { action: AgentMarketActionPayload };
          const msg: WsMessage<WsEventName> = {
            type: WS_EVENT_NAMES.AGENT_MARKET_ACTION,
            payload: action,
          };
          // Broadcast to market room
          this.broadcastToLocalRoom(`${ROOM_PREFIX}${action.marketId}`, msg);
          // Broadcast to agent-scoped room
          this.broadcastToLocalRoom(`${ROOM_PREFIX}${action.marketId}:agent:${action.agentId}`, msg);
          // Broadcast to global agent room
          this.broadcastToLocalRoom(`agent:${action.agentId}`, msg);
          return;
        }
        if (channel === REDIS_CHANNELS.LMSR_PRICING) {
          const { payload, userId, agentId } = JSON.parse(message) as {
            type: string;
            payload: LMSRPricingUpdatePayload;
            userId?: string;
            agentId?: string;
          };
          const msg: WsMessage<WsEventName> = {
            type: WS_EVENT_NAMES.LMSR_PRICING_UPDATE,
            payload,
          };
          // Broadcast to main market room
          this.broadcastToLocalRoom(`${ROOM_PREFIX}${payload.marketId}`, msg);
          // If user-specific, also broadcast to user-scoped room
          if (userId) {
            this.broadcastToLocalRoom(`${ROOM_PREFIX}${payload.marketId}:user:${userId}`, msg);
          }
          // If agent-specific, also broadcast to agent-scoped room
          if (agentId) {
            this.broadcastToLocalRoom(`${ROOM_PREFIX}${payload.marketId}:agent:${agentId}`, msg);
          }
          return;
        }
      } catch {
        // ignore malformed
      }
    });
    } catch (err) {
      console.error("[SocketManager] Redis subscribe failed (OOM or unreachable). WebSocket real-time updates disabled. REST APIs will work.", err);
      this.redisSub = null;
    }
  }

  addSocket(socket: WebSocket, req: FastifyRequest): void {
    if (!socket || typeof socket.on !== "function") {
      console.error("Invalid WebSocket instance passed to addSocket");
      return;
    }
    const userId = req.auth?.type === "user" ? (req.auth.userId ?? req.auth.address) : null;
    this.socketUserId.set(socket, userId);
    this.socketToRooms.set(socket, new Set());
    this.socketMeta.set(socket, { lastPongAt: Date.now(), heartbeatTimer: null });
    this.startHeartbeat(socket);

    socket.on("message", (raw: Buffer | string) => {
      this.handleMessage(socket, raw).catch((err) => {
        console.error("WS message handler error:", err);
        this.sendError(socket, "INVALID_MESSAGE", String(err));
      });
    });

    socket.on("close", () => this.removeSocket(socket));
    socket.on("error", () => this.removeSocket(socket));
  }

  private startHeartbeat(socket: WebSocket): void {
    const meta = this.socketMeta.get(socket);
    if (meta === undefined) return;
    const timer = setInterval(() => {
      const m = this.socketMeta.get(socket);
      if (socket.readyState !== 1) {
        this.clearHeartbeat(socket);
        return;
      }
      if (m === undefined) return;
      const elapsed = Date.now() - m.lastPongAt;
      if (elapsed > HEARTBEAT_INTERVAL_MS * 2) {
        socket.terminate();
        return;
      }
      this.send(socket, { type: WS_EVENT_NAMES.PING, payload: undefined });
    }, HEARTBEAT_INTERVAL_MS);
    const current = this.socketMeta.get(socket);
    if (current !== undefined) current.heartbeatTimer = timer;
  }

  private clearHeartbeat(socket: WebSocket): void {
    const meta = this.socketMeta.get(socket);
    if (meta === undefined) return;
    if (meta.heartbeatTimer !== null) {
      clearInterval(meta.heartbeatTimer);
      meta.heartbeatTimer = null;
    }
  }

  private async handleMessage(socket: WebSocket, raw: Buffer | string): Promise<void> {
    const text = typeof raw === "string" ? raw : raw.toString("utf8");
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      this.sendError(socket, "INVALID_JSON", "Invalid JSON");
      return;
    }

    const parsed = wsMessageSchema.safeParse(data);
    if (!parsed.success) {
      this.sendError(socket, "VALIDATION_ERROR", parsed.error.message);
      return;
    }

    const msg = parsed.data;

    const subParsed = subscribeMessageSchema.safeParse(msg);
    if (subParsed.success) {
      this.subscribe(socket, subParsed.data.payload.room);
      return;
    }
    const unsubParsed = unsubscribeMessageSchema.safeParse(msg);
    if (unsubParsed.success) {
      this.unsubscribe(socket, unsubParsed.data.payload.room);
      return;
    }
    if (msg.type === WS_EVENT_NAMES.PING || msg.type === WS_EVENT_NAMES.PONG) {
      const meta = this.socketMeta.get(socket);
      if (meta) meta.lastPongAt = Date.now();
      if (msg.type === WS_EVENT_NAMES.PING) {
        this.send(socket, { type: WS_EVENT_NAMES.PONG, payload: undefined });
      }
      return;
    }
  }

  subscribe(socket: WebSocket, room: string, filters?: RoomFilters): void {
    let set = this.rooms.get(room);
    if (set === undefined) {
      set = new Set();
      this.rooms.set(room, set);
    }
    set.add(socket);
    this.socketToRooms.get(socket)?.add(room);
    // Store filters if provided
    if (filters) {
      let socketFilters = this.roomFilters.get(socket);
      if (!socketFilters) {
        socketFilters = new Map();
        this.roomFilters.set(socket, socketFilters);
      }
      socketFilters.set(room, filters);
    }
  }

  unsubscribe(socket: WebSocket, room: string): void {
    this.rooms.get(room)?.delete(socket);
    this.socketToRooms.get(socket)?.delete(room);
    // Remove filters for this room
    this.roomFilters.get(socket)?.delete(room);
  }

  removeSocket(socket: WebSocket): void {
    this.clearHeartbeat(socket);
    this.socketToRooms.get(socket)?.forEach((room) => {
      this.rooms.get(room)?.delete(socket);
    });
    this.socketToRooms.delete(socket);
    this.socketMeta.delete(socket);
    this.socketUserId.delete(socket);
    this.roomFilters.delete(socket);
  }

  send<E extends WsEventName>(socket: WebSocket, message: WsMessage<E>): void {
    if (socket.readyState !== 1) return;
    socket.send(JSON.stringify(message));
  }

  private sendError(socket: WebSocket, code: string, message: string): void {
    this.send(socket, {
      type: WS_EVENT_NAMES.ERROR,
      payload: { code, message },
    });
  }

  private broadcastToLocalRoom(room: string, message: WsMessage<WsEventName>, filters?: RoomFilters): void {
    const set = this.rooms.get(room);
    if (!set) return;
    const payload = JSON.stringify(message);
    for (const ws of set) {
      if (ws.readyState !== 1) continue;
      // Check socket-specific filters if they exist
      const socketFilters = this.roomFilters.get(ws)?.get(room);
      if (socketFilters) {
        // Filter by event type if specified
        if (socketFilters.eventTypes && !socketFilters.eventTypes.includes(message.type)) {
          continue;
        }
      }
      ws.send(payload);
    }
  }

  async broadcastToRoom(room: string, message: WsMessage<WsEventName>, filters?: RoomFilters): Promise<void> {
    this.broadcastToLocalRoom(room, message, filters);
    const pub = await getRedisPublisher();
    await pub.publish(
      BROADCAST_CHANNEL,
      JSON.stringify({ room, payload: message, filters })
    );
  }
}

export function getSocketManager(): SocketManager {
  return SocketManager.getInstance();
}
