import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/env.js", () => ({ env: { jwtSecret: "test-secret" } }));
vi.mock("../../../src/db/connect.js", () => ({ isMongoConnected: vi.fn(() => true) }));
vi.mock("../../../src/models/User.js", () => ({ UserModel: { findById: vi.fn() } }));

const { UserModel } = await import("../../../src/models/User.js");
const { sessionRevocation } = await import("../../../src/middleware/sessionRevocation.js");

const findById = vi.mocked(UserModel.findById);

function lookup(passwordChangedAt?: Date) {
  findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ passwordChangedAt }) }) } as never);
}

async function run(authorization?: string) {
  const req = { header: (n: string) => (n.toLowerCase() === "authorization" ? authorization : undefined) } as unknown as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const next = vi.fn() as NextFunction;
  await sessionRevocation(req, res as unknown as Response, next);
  return { res, next };
}

const tokenIssuedAt = (iat: number) => jwt.sign({ iat }, "test-secret", { subject: "u1" });
const now = Math.floor(Date.now() / 1000);

beforeEach(() => vi.clearAllMocks());

describe("sessionRevocation", () => {
  it("lets anonymous requests through without a lookup", async () => {
    const { next } = await run(undefined);
    expect(next).toHaveBeenCalledOnce();
    expect(findById).not.toHaveBeenCalled();
  });

  it("lets a token through when the password was never reset", async () => {
    lookup(undefined);
    const { next, res } = await run(`Bearer ${tokenIssuedAt(now - 100)}`);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a token issued before the last password reset", async () => {
    lookup(new Date((now - 10) * 1000));
    const { next, res } = await run(`Bearer ${tokenIssuedAt(now - 100)}`);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts a token issued after the last password reset", async () => {
    lookup(new Date((now - 100) * 1000));
    const { next } = await run(`Bearer ${tokenIssuedAt(now - 10)}`);
    expect(next).toHaveBeenCalledOnce();
  });

  it("leaves invalid tokens for requireAuth to reject", async () => {
    const { next } = await run("Bearer garbage");
    expect(next).toHaveBeenCalledOnce();
    expect(findById).not.toHaveBeenCalled();
  });
});
