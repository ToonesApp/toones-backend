import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";

import { env } from "../config/env.js";

type AuthTokenPayload = JwtPayload & {
  sub: string;
};

function getBearerToken(req: Request): string | null {
  const header = req.header("authorization");

  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
}

function verifyToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret);

    if (typeof decoded === "string" || !decoded.sub) {
      return null;
    }

    return (decoded as AuthTokenPayload).sub;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = getBearerToken(req);

  if (!token) {
    res.status(401).json({ error: "Missing bearer token." });
    return;
  }

  if (!env.jwtSecret) {
    res.status(500).json({ error: "JWT_SECRET is not configured." });
    return;
  }

  const userId = verifyToken(token);

  if (!userId) {
    res.status(401).json({ error: "Invalid token." });
    return;
  }

  req.auth = { userId };
  next();
}

/** Sets req.auth when a valid token is sent; anonymous requests pass through. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = getBearerToken(req);
  const userId = token && env.jwtSecret ? verifyToken(token) : null;

  if (userId) {
    req.auth = { userId };
  }

  next();
}
