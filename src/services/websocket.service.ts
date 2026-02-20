import type { WebSocket } from "ws";
import type { FastifyRequest } from "fastify";
import { HEARTBEAT_INTERVAL_MS } from "../config/index.js";
import { WS_EVENT_NAMES } from "../types/websocket-events.js";
import {
  wsMessageSchema,
  subscribeMessageSchema,
  unsubscribeMessageSchema,
  pingMessageSchema,
} from "../schemas/websocket.schema.js";
import type { WsMessage, WsEventName } from "../types/websocket-events.js";
import { getRedisPublisher, getRedisSubscriber } from "../lib/redis.js";

const BROADCAST_CHANNEL = "ws:broadcast";

interface SocketMeta {
  lastPongAt: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
}

export class SocketManager {
  private static instance: SocketManager | null = null;
  private readonly rooms = new Map<string, Set<WebSocket>>();
  private readonly socketToRooms = new Map<WebSocket, Set<string>>();
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
    const sub = await getRedisSubscriber();
    this.redisSub = sub;
    await sub.subscribe(BROADCAST_CHANNEL);
    sub.on("message", (channel: string, message: string) => {
      if (channel !== BROADCAST_CHANNEL) return;
      try {
        const { room, payload } = JSON.parse(message) as {
          room: string;
          payload: WsMessage<WsEventName>;
        };
        this.broadcastToLocalRoom(room, payload);
      } catch {
        // ignore malformed
      }
    });
  }

  addSocket(socket: WebSocket, req: FastifyRequest): void {
    const userId = (req as FastifyRequest & { userId?: string | null }).userId ?? null;
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
    if (pingMessageSchema.safeParse(msg).success) {
      const meta = this.socketMeta.get(socket);
      if (meta) meta.lastPongAt = Date.now();
      this.send(socket, { type: WS_EVENT_NAMES.PONG, payload: undefined });
      return;
    }
  }

  subscribe(socket: WebSocket, room: string): void {
    let set = this.rooms.get(room);
    if (set === undefined) {
      set = new Set();
      this.rooms.set(room, set);
    }
    set.add(socket);
    this.socketToRooms.get(socket)?.add(room);
  }

  unsubscribe(socket: WebSocket, room: string): void {
    this.rooms.get(room)?.delete(socket);
    this.socketToRooms.get(socket)?.delete(room);
  }

  removeSocket(socket: WebSocket): void {
    this.clearHeartbeat(socket);
    this.socketToRooms.get(socket)?.forEach((room) => {
      this.rooms.get(room)?.delete(socket);
    });
    this.socketToRooms.delete(socket);
    this.socketMeta.delete(socket);
    this.socketUserId.delete(socket);
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

  private broadcastToLocalRoom(room: string, message: WsMessage<WsEventName>): void {
    const set = this.rooms.get(room);
    if (!set) return;
    const payload = JSON.stringify(message);
    for (const ws of set) {
      if (ws.readyState === 1) ws.send(payload);
    }
  }

  async broadcastToRoom(room: string, message: WsMessage<WsEventName>): Promise<void> {
    this.broadcastToLocalRoom(room, message);
    const pub = await getRedisPublisher();
    await pub.publish(
      BROADCAST_CHANNEL,
      JSON.stringify({ room, payload: message })
    );
  }
}

export function getSocketManager(): SocketManager {
  return SocketManager.getInstance();
}
