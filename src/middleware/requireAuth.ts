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

  try {
    const decoded = jwt.verify(token, env.jwtSecret);

    if (typeof decoded === "string" || !decoded.sub) {
      res.status(401).json({ error: "Invalid token." });
      return;
    }

    req.auth = { userId: (decoded as AuthTokenPayload).sub };
    next();
  } catch {
    res.status(401).json({ error: "Invalid token." });
  }
}
