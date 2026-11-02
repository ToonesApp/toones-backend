import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import bcrypt from "bcrypt";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/env.js", () => ({ env: { appUrl: "https://app.toones.test" } }));
vi.mock("../../../src/db/connect.js", () => ({ isMongoConnected: vi.fn(() => true) }));
vi.mock("../../../src/middleware/rateLimit.js", () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { forgotPasswordLimiter: pass, resetPasswordLimiter: pass };
});
vi.mock("../../../src/lib/mailer.js", () => ({
  sendEmail: vi.fn(async () => {}),
  passwordResetEmail: vi.fn((to: string, _name: string, link: string) => ({ to, subject: "reset", text: link, html: link })),
  passwordChangedEmail: vi.fn((to: string) => ({ to, subject: "changed", text: "", html: "" }))
}));
vi.mock("../../../src/models/User.js", () => ({ UserModel: { findOne: vi.fn(), findById: vi.fn() } }));
vi.mock("../../../src/models/PasswordReset.js", () => ({
  PasswordResetModel: { findOne: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), findOneAndDelete: vi.fn() }
}));

const { UserModel } = await import("../../../src/models/User.js");
const { PasswordResetModel } = await import("../../../src/models/PasswordReset.js");
const { sendEmail } = await import("../../../src/lib/mailer.js");
const { isMongoConnected } = await import("../../../src/db/connect.js");
const { default: router } = await import("../../../src/routes/passwordReset.js");

const users = vi.mocked(UserModel);
const resets = vi.mocked(PasswordResetModel);
const mail = vi.mocked(sendEmail);

let server: Server;
let baseUrl: string;

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}/auth${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/auth", router);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isMongoConnected).mockReturnValue(true);
  resets.findOne.mockResolvedValue(null as never);
  resets.deleteMany.mockResolvedValue({} as never);
  resets.create.mockResolvedValue({} as never);
});

describe("POST /auth/forgot-password", () => {
  it("rejects a malformed email", async () => {
    const res = await post("/forgot-password", { email: "nope" });
    expect(res.status).toBe(400);
    expect(mail).not.toHaveBeenCalled();
  });

  it("answers 200 and sends nothing for an unknown email (no account enumeration)", async () => {
    users.findOne.mockResolvedValue(null as never);
    const res = await post("/forgot-password", { email: "ghost@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if an account exists/i);
    await new Promise((r) => setTimeout(r, 30));
    expect(mail).not.toHaveBeenCalled();
  });

  it("emails a one-time link for a known account and stores only its hash", async () => {
    users.findOne.mockResolvedValue({ _id: "u1", email: "maya@example.com", displayName: "Maya" } as never);
    const res = await post("/forgot-password", { email: " Maya@Example.com " });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(mail).toHaveBeenCalledTimes(1));

    const link = mail.mock.calls[0][0].text;
    const token = new URL(link).searchParams.get("token") as string;
    expect(link.startsWith("https://app.toones.test/reset-password?token=")).toBe(true);

    const stored = resets.create.mock.calls[0][0] as unknown as { tokenHash: string; expiresAt: Date };
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(resets.deleteMany).toHaveBeenCalled(); // older links are voided
  });

  it("skips the email when one was requested a moment ago", async () => {
    users.findOne.mockResolvedValue({ _id: "u1", email: "maya@example.com", displayName: "Maya" } as never);
    resets.findOne.mockResolvedValue({ _id: "r1" } as never);
    const res = await post("/forgot-password", { email: "maya@example.com" });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 30));
    expect(mail).not.toHaveBeenCalled();
  });

  it("returns 503 when the database is down", async () => {
    vi.mocked(isMongoConnected).mockReturnValue(false);
    expect((await post("/forgot-password", { email: "maya@example.com" })).status).toBe(503);
  });
});

describe("POST /auth/reset-password", () => {
  it("rejects a missing token", async () => {
    const res = await post("/reset-password", { password: "brand-new-pass" });
    expect(res.status).toBe(400);
  });

  it("rejects a weak password before touching the token", async () => {
    const res = await post("/reset-password", { token: "abc", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 8/);
    expect(resets.findOneAndDelete).not.toHaveBeenCalled();
  });

  it("rejects an unknown or expired token", async () => {
    resets.findOneAndDelete.mockResolvedValue(null as never);
    const res = await post("/reset-password", { token: "stale", password: "brand-new-pass" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or has expired/i);
  });

  it("sets the new password hash, voids other links and notifies the owner", async () => {
    resets.findOneAndDelete.mockResolvedValue({ userId: "u1" } as never);
    const user = { _id: "u1", email: "maya@example.com", displayName: "Maya", passwordHash: "old", save: vi.fn(async () => {}) };
    users.findById.mockReturnValue({ select: () => Promise.resolve(user) } as never);

    const res = await post("/reset-password", { token: "good-token", password: "brand-new-pass" });
    expect(res.status).toBe(200);
    expect(await bcrypt.compare("brand-new-pass", user.passwordHash)).toBe(true);
    expect(user.save).toHaveBeenCalled();
    expect((user as { passwordChangedAt?: Date }).passwordChangedAt).toBeInstanceOf(Date); // signs out old sessions
    expect(resets.deleteMany).toHaveBeenCalledWith({ userId: "u1" });
    await vi.waitFor(() => expect(mail).toHaveBeenCalledTimes(1));
  });
});
