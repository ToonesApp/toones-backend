import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/env.js", () => ({ env: { jwtSecret: "test-secret" } }));

const { signMediaPath, requireSignedMedia } = await import("../../../src/middleware/mediaUrl.js");

/** Splits a signed path ("/a/b?t=...") into the pieces the middleware reads off a request. */
function parse(signed: string) {
  const [path, query] = signed.split("?");
  const t = new URLSearchParams(query).get("t") ?? undefined;
  return { path, t };
}

function callRequireSignedMedia(path: string, t: string | undefined) {
  const req = { baseUrl: "", path, query: { t } } as unknown as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const next = vi.fn() as NextFunction;

  requireSignedMedia(req, res as unknown as Response, next);
  return { res, next };
}

describe("signed media URLs", () => {
  it("[MEDIA-01] should accept a freshly signed path", () => {
    const { path, t } = parse(signMediaPath("/sounds/abc/audio"));
    const { res, next } = callRequireSignedMedia(path, t);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("[MEDIA-02] should return 403 when the signature is missing or malformed", () => {
    for (const t of [undefined, "", "nodot", "123.", ".sig"]) {
      const { res, next } = callRequireSignedMedia("/sounds/abc/audio", t);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it("[MEDIA-03] should return 403 when the link has expired", () => {
    vi.useFakeTimers();
    try {
      const { path, t } = parse(signMediaPath("/sounds/abc/audio"));
      vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000); // past the 1h TTL
      const { res, next } = callRequireSignedMedia(path, t);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("[MEDIA-04] should reject a signature minted for a different resource", () => {
    const { t } = parse(signMediaPath("/sounds/abc/audio"));
    // Same token, different path — the signature is bound to the path, so this must fail.
    const { res, next } = callRequireSignedMedia("/sounds/xyz/audio", t);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
