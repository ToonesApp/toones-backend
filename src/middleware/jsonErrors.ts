import type { NextFunction, Request, Response } from "express";

/** Turns body-parser failures into the same `{ error }` JSON shape every route uses, instead of Express's HTML page. */
export function jsonBodyErrors(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  const type = (err as { type?: string } | null)?.type;

  if (type === "entity.parse.failed") {
    res.status(400).json({ error: "Request body must be valid JSON." });
    return;
  }

  if (type === "entity.too.large") {
    res.status(413).json({ error: "Request body is too large." });
    return;
  }

  next(err);
}
