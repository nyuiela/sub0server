import jwt from "jsonwebtoken";
import { config } from "../config/index.js";

export interface JwtPayload {
  sub: string;
  email?: string;
  iat?: number;
  exp?: number;
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}

export function getTokenFromRequest(authHeader: string | undefined, queryToken?: string): string | null {
  if (queryToken && typeof queryToken === "string") return queryToken;
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  return null;
}
