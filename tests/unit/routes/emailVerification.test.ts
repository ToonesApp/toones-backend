import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/env.js", () => ({ env: { jwtSecret: "test-secret", appUrl: "https://app.toones.test" } }));
vi.mock("../../../src/db/connect.js", () => ({ isMongoConnected: vi.fn(() => true) }));
vi.mock("../../../src/middleware/rateLimit.js", () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { verifyEmailLimiter: pass, resendVerificationLimiter: pass };
});
vi.mock("../../../src/lib/emailVerification.js", () => ({
  hashToken: (t: string) => `hash:${t}`,
  issueVerificationEmail: vi.fn()
}));
vi.mock("../../../src/models/User.js", () => ({ UserModel: { findById: vi.fn(), findOneAndUpdate: vi.fn() } }));
vi.mock("../../../src/models/EmailVerification.js", () => ({ EmailVerificationModel: { findOneAndDelete: vi.fn() } }));

const { UserModel } = await import("../../../src/models/User.js");
const { EmailVerificationModel } = await import("../../../src/models/EmailVerification.js");
const { issueVerificationEmail } = await import("../../../src/lib/emailVerification.js");
const { default: router } = await import("../../../src/routes/emailVerification.js");

const users = vi.mocked(UserModel);
const records = vi.mocked(EmailVerificationModel);
const issue = vi.mocked(issueVerificationEmail);

let server: Server;
let baseUrl: string;

async function post(path: string, body: unknown = {}, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}/auth${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const bearer = () => ({ Authorization: `Bearer ${jwt.sign({}, "test-secret", { subject: "u1" })}` });

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/auth", router);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => vi.clearAllMocks());

describe("POST /auth/verify-email", () => {
  it("rejects a missing token", async () => {
    expect((await post("/verify-email", {})).status).toBe(400);
  });

  it("rejects an unknown or expired token", async () => {
    records.findOneAndDelete.mockResolvedValue(null as never);
    const res = await post("/verify-email", { token: "stale" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or has expired/i);
  });

  it("marks the account verified, but only if it still has the emailed address", async () => {
    records.findOneAndDelete.mockResolvedValue({ userId: "u1", email: "maya@example.com" } as never);
    users.findOneAndUpdate.mockResolvedValue({ _id: "u1" } as never);
    const res = await post("/verify-email", { token: "good" });
    expect(res.status).toBe(200);
    expect(res.body.emailVerified).toBe(true);
    expect(users.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "u1", email: "maya@example.com" },
      { $set: { emailVerified: true } },
      { new: true }
    );
  });

  it("rejects a link for an address the account no longer has", async () => {
    records.findOneAndDelete.mockResolvedValue({ userId: "u1", email: "old@example.com" } as never);
    users.findOneAndUpdate.mockResolvedValue(null as never);
    expect((await post("/verify-email", { token: "good" })).status).toBe(400);
  });
});

describe("POST /auth/resend-verification", () => {
  it("requires sign-in", async () => {
    expect((await post("/resend-verification")).status).toBe(401);
  });

  it("does nothing for an already verified account", async () => {
    users.findById.mockResolvedValue({ _id: "u1", emailVerified: true } as never);
    const res = await post("/resend-verification", {}, bearer());
    expect(res.status).toBe(200);
    expect(res.body.emailVerified).toBe(true);
    expect(issue).not.toHaveBeenCalled();
  });

  it("sends a new link to an unverified account", async () => {
    users.findById.mockResolvedValue({ _id: "u1", email: "maya@example.com", displayName: "Maya" } as never);
    issue.mockResolvedValue(true);
    expect((await post("/resend-verification", {}, bearer())).status).toBe(200);
    expect(issue).toHaveBeenCalledOnce();
  });

  it("answers 429 when one was just sent", async () => {
    users.findById.mockResolvedValue({ _id: "u1", email: "maya@example.com", displayName: "Maya" } as never);
    issue.mockResolvedValue(false);
    expect((await post("/resend-verification", {}, bearer())).status).toBe(429);
  });
});
