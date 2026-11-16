import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import { env } from "../config/env.js";

// Long enough to open a drop and listen; short enough a leaked URL dies within the hour.
const MEDIA_URL_TTL_MS = 60 * 60 * 1000;

function sign(resourcePath: string, exp: number): string {
  return crypto.createHmac("sha256", env.jwtSecret).update(`${resourcePath}\n${exp}`).digest("base64url");
}

/** Appends a short-lived signature to a media PATH (no origin) so <audio>/<img> can load it without a header. */
export function signMediaPath(resourcePath: string): string {
  const exp = Date.now() + MEDIA_URL_TTL_MS;
  return `${resourcePath}?t=${exp}.${sign(resourcePath, exp)}`;
}

/** Rejects media requests whose `?t=` signature is missing, forged or expired. */
export function requireSignedMedia(req: Request, res: Response, next: NextFunction): void {
  if (!env.jwtSecret) {
    res.status(500).json({ error: "Media signing secret is not configured." });
    return;
  }

  const raw = typeof req.query.t === "string" ? req.query.t : "";
  const dot = raw.indexOf(".");

  if (dot < 1) {
    res.status(403).json({ error: "Missing or malformed media signature." });
    return;
  }

  const exp = Number(raw.slice(0, dot));
  const sig = raw.slice(dot + 1);

  if (!Number.isFinite(exp) || Date.now() > exp) {
    res.status(403).json({ error: "Media link is invalid or expired." });
    return;
  }

  // Sign over the path only (query excluded), matching how the URL was minted.
  const expected = sign(req.baseUrl + req.path, exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(403).json({ error: "Invalid media signature." });
    return;
  }

  next();
}
