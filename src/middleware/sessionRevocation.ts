import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "../config/env.js";
import { isMongoConnected } from "../db/connect.js";
import { UserModel } from "../models/User.js";

/**
 * Rejects tokens issued before the account's last password reset, so a stolen session stops working
 * the moment the owner resets their password. Tokens are stateless JWTs, so this is the only place
 * that can revoke them. Runs ahead of every router; requests without a valid token pass straight
 * through for the route's own auth to handle.
 */
export async function sessionRevocation(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.header("authorization");

  if (!header?.startsWith("Bearer ") || !env.jwtSecret || !isMongoConnected()) {
    next();
    return;
  }

  let payload: jwt.JwtPayload;

  try {
    const decoded = jwt.verify(header.slice("Bearer ".length).trim(), env.jwtSecret);

    if (typeof decoded === "string" || !decoded.sub) {
      next();
      return;
    }

    payload = decoded;
  } catch {
    next();
    return;
  }

  try {
    const user = await UserModel.findById(payload.sub).select("passwordChangedAt").lean();
    const changedAt = user?.passwordChangedAt;

    // JWT `iat` has one-second resolution, so compare in seconds.
    if (changedAt && (payload.iat ?? 0) < Math.floor(changedAt.getTime() / 1000)) {
      res.status(401).json({ error: "Your session has expired. Please sign in again." });
      return;
    }
  } catch {
    // If the lookup fails, fall back to normal token checks rather than locking everyone out.
  }

  next();
}
