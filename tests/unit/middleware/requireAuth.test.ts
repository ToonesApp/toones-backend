import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { describe, expect, it, vi } from "vitest";

const TEST_SECRET = "test-secret";

vi.mock("../../../src/config/env.js", () => ({ env: { jwtSecret: "test-secret" } }));

const { requireAuth } = await import("../../../src/middleware/requireAuth.js");

function callRequireAuth(authorization?: string) {
  const req = {
    header: (name: string) => (name.toLowerCase() === "authorization" ? authorization : undefined)
  } as unknown as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const next = vi.fn() as NextFunction;

  requireAuth(req, res as unknown as Response, next);
  return { req, res, next };
}

describe("requireAuth", () => {
  it("[AUTH-01] should return 401 when the request has no bearer token", () => {
    const { res, next } = callRequireAuth(undefined);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("[AUTH-02] should return 401 when the token is fake or signed with the wrong secret", () => {
    const forged = jwt.sign({}, "some-other-secret", { subject: "user-123" });

    for (const token of ["not-a-real-token", forged]) {
      const { res, next } = callRequireAuth(`Bearer ${token}`);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it("[AUTH-03] should let the request through and identify the user when the token is valid", () => {
    const token = jwt.sign({}, TEST_SECRET, { subject: "user-123", expiresIn: "7d" });

    const { req, res, next } = callRequireAuth(`Bearer ${token}`);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.auth).toEqual({ userId: "user-123" });
  });
});
