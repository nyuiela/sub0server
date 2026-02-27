import { createHash } from "crypto";
import { createAuth } from "thirdweb/auth";
import { createThirdwebClient } from "thirdweb";
import { privateKeyToAccount } from "thirdweb/wallets";
import type { FastifyRequest } from "fastify";
import { config } from "../config/index.js";
import { getPrismaClient } from "./prisma.js";
import { getAgentRegistrationModel } from "./agent-registration-db.js";

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

/** Parse Cookie header for a given name (fallback when req.cookies not populated). */
function getCookieFromHeader(cookieHeader: string | undefined, name: string): string | null {
  if (typeof cookieHeader !== "string") return null;
  const regex = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`);
  const match = regex.exec(cookieHeader);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1].trim());
  } catch {
    return match[1].trim();
  }
}

export function getJwtFromRequest(req: FastifyRequest): string | null {
  const cookieName = config.authCookieName;
  const cookie = req.cookies?.[cookieName];
  if (cookie && typeof cookie === "string") return cookie;
  const legacyCookie = req.cookies?.["jwt"];
  if (legacyCookie && typeof legacyCookie === "string") return legacyCookie;
  const cookieHeader = req.headers["cookie"];
  const fromHeader = getCookieFromHeader(cookieHeader, cookieName);
  if (fromHeader) return fromHeader;
  const legacy = getCookieFromHeader(cookieHeader, "jwt");
  if (legacy) return legacy;
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

const CRE_GENERATED_PREFIX_LOWER = "cre-generated ";
const CRE_GENERATED_PREFIX_LEN = "CRE-Generated ".length;

/** Returns the API key if Authorization is "CRE-Generated <apiKey>", else null. */
export function getCreGeneratedApiKey(req: FastifyRequest): string | null {
  const auth = req.headers[AUTH_HEADER];
  if (typeof auth !== "string") return null;
  const trimmed = auth.trim();
  if (!trimmed.toLowerCase().startsWith(CRE_GENERATED_PREFIX_LOWER)) return null;
  return trimmed.slice(CRE_GENERATED_PREFIX_LEN).trim() || null;
}

/** Token that might be internal API key or SDK agent api_key (Bearer or x-api-key). */
export function getBearerOrApiKeyToken(req: FastifyRequest): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return getApiKeyFromRequest(req);
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

/** True if key matches API_KEY or CRE_HTTP_API_KEY (for CRE-Generated header). */
export function verifyCreGeneratedKey(key: string): boolean {
  const api = config.apiKey ?? config.creHttpApiKey;
  if (!api) return false;
  return key === api;
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

  const agentToken = getBearerOrApiKeyToken(req);
  if (agentToken !== null && agentToken.length > 0) {
    const auth = await resolveAgentApiKey(agentToken);
    if (auth != null) return auth;
  }

  return null;
}

async function resolveAgentApiKey(rawToken: string): Promise<import("../types/auth.js").AuthAgent | null> {
  const hash = hashAgentApiKey(rawToken);
  const agentReg = getAgentRegistrationModel();
  const reg = await agentReg.findFirst({
    where: { apiKeyHash: hash },
    select: { id: true, claimedAgentId: true, claimedByUserId: true, walletAddress: true },
  });
  if (!reg) return null;
  return {
    type: "agent",
    registrationId: reg.id as string,
    claimedAgentId: (reg.claimedAgentId as string | null) ?? null,
    claimedUserId: (reg.claimedByUserId as string | null) ?? null,
    walletAddress: reg.walletAddress as string,
  };
}

export function hashAgentApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

export function requireUser(req: FastifyRequest): import("../types/auth.js").AuthUser | null {
  const auth = req.auth;
  if (auth?.type === "user") return auth;
  return null;
}

export function requireApiKey(req: FastifyRequest): boolean {
  return req.auth?.type === "apiKey";
}

export function requireAgent(req: FastifyRequest): import("../types/auth.js").AuthAgent | null {
  const auth = req.auth;
  if (auth?.type === "agent") return auth;
  return null;
}
