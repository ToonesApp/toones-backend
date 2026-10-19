import type { NextFunction, Request, Response } from "express";

import { isMongoConnected } from "../db/connect.js";

export function requireMongo(_req: Request, res: Response, next: NextFunction): void {
  if (!isMongoConnected()) {
    res.status(503).json({ error: "Database is not connected." });
    return;
  }

  next();
}
