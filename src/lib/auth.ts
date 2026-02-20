import { createAuth } from "thirdweb/auth";
import { createThirdwebClient } from "thirdweb";
import { privateKeyToAccount } from "thirdweb/wallets";
import type { FastifyRequest } from "fastify";
import { config } from "../config/index.js";
import { getPrismaClient } from "./prisma.js";

let authInstance: ReturnType<typeof createAuth> | null = null;

function getThirdwebAuth(): ReturnType<typeof createAuth> | null {
  const secretKey = config.thirdwebSecretKey;
  const adminPk = config.thirdwebAdminPrivateKey;
  const domain = config.authDomain;
  if (!secretKey || !adminPk || !domain) return null;
  if (authInstance === null) {
    const client = createThirdwebClient({ secretKey });
    const adminAccount = privateKeyToAccount({
      client,
      privateKey: adminPk as string,
    });
    authInstance = createAuth({
      domain,
      client,
      adminAccount,
    });
  }
  return authInstance;
}

const AUTH_HEADER = "authorization";

export function getJwtFromRequest(req: FastifyRequest): string | null {
  const cookieName = config.authCookieName;
  const cookie = req.cookies?.[cookieName];
  if (cookie && typeof cookie === "string") return cookie;
  const legacyCookie = req.cookies?.["jwt"];
  if (legacyCookie && typeof legacyCookie === "string") return legacyCookie;
  const auth = req.headers[AUTH_HEADER];
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const q = req.query as { token?: string };
  if (q?.token && typeof q.token === "string") return q.token;
  return null;
}

export function getApiKeyFromRequest(req: FastifyRequest): string | null {
  const header = req.headers["x-api-key"] ?? req.headers["api-key"];
  if (typeof header === "string") return header;
  return null;
}

export async function verifyThirdwebJwt(jwt: string): Promise<{ address: string } | null> {
  const auth = getThirdwebAuth();
  if (!auth) return null;
  const result = await auth.verifyJWT({ jwt });
  if (!result.valid || !("parsedJWT" in result)) return null;
  const sub = result.parsedJWT.sub;
  return typeof sub === "string" ? { address: sub.toLowerCase() } : null;
}

export function verifyApiKey(key: string): boolean {
  const expected = config.apiKey;
  if (!expected) return false;
  return key === expected;
}

export async function resolveRequestAuth(req: FastifyRequest): Promise<import("../types/auth.js").RequestAuth> {
  const apiKey = getApiKeyFromRequest(req);
  if (apiKey !== null && verifyApiKey(apiKey)) {
    return { type: "apiKey" };
  }

  const jwt = getJwtFromRequest(req);
  if (jwt !== null) {
    const payload = await verifyThirdwebJwt(jwt);
    if (payload !== null) {
      const prisma = getPrismaClient();
      const user = await prisma.user.findUnique({
        where: { address: payload.address },
        select: { id: true },
      });
      return {
        type: "user",
        address: payload.address,
        userId: user?.id,
      };
    }
  }

  return null;
}

export function requireUser(req: FastifyRequest): import("../types/auth.js").AuthUser | null {
  const auth = req.auth;
  if (auth?.type === "user") return auth;
  return null;
}

export function requireApiKey(req: FastifyRequest): boolean {
  return req.auth?.type === "apiKey";
}
