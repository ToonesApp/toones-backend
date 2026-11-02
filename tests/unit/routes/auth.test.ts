import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import bcrypt from "bcrypt";
import express from "express";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/env.js", () => ({ env: { jwtSecret: "test-secret", googleClientId: "" } }));
vi.mock("../../../src/db/connect.js", () => ({ isMongoConnected: () => true }));
// Rate limits have their own tests (RATE-*); here they would block the repeated validation requests.
vi.mock("../../../src/middleware/rateLimit.js", () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { loginLimiter: pass, registerLimiter: pass, googleLimiter: pass };
});
vi.mock("../../../src/models/User.js", () => ({
  UserModel: { findOne: vi.fn(), create: vi.fn(), exists: vi.fn() }
}));

const { UserModel } = await import("../../../src/models/User.js");
const { default: authRouter } = await import("../../../src/routes/auth.js");

const users = vi.mocked(UserModel);

/** Mimics a Mongoose query: awaitable directly, or after `.select(...)`. */
function query<T>(value: T) {
  return Object.assign(Promise.resolve(value), { select: () => Promise.resolve(value) });
}

function fakeUser(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => "user-123" },
    email: "maya@example.com",
    username: "maya",
    displayName: "Maya",
    xp: 0,
    level: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides
  };
}

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

const validSignup = { email: "maya@example.com", displayName: "Maya", password: "correct-horse" };

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/auth", authRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  vi.resetAllMocks();
  users.findOne.mockReturnValue(query(null) as never);
  users.exists.mockResolvedValue(null as never);
  users.create.mockImplementation((async (doc: Record<string, unknown>) => fakeUser(doc)) as never);
});

describe("POST /auth/register", () => {
  it("[AUTH-04] should create the account with a normalized email and a hashed password when the signup is valid", async () => {
    const { status, body } = await post("/register", { ...validSignup, email: "  Maya@Example.COM " });

    expect(status).toBe(201);
    expect(jwt.verify(body.token, "test-secret")).toMatchObject({ sub: "user-123" });

    const saved = users.create.mock.calls[0][0] as unknown as Record<string, string>;
    expect(saved.email).toBe("maya@example.com");
    expect(saved).not.toHaveProperty("password");
    expect(saved.passwordHash).not.toBe(validSignup.password);
    expect(await bcrypt.compare(validSignup.password, saved.passwordHash)).toBe(true);
  });

  it("[AUTH-05] should reject the signup with 400 when the email format is invalid", async () => {
    for (const email of ["maya", "maya@", "maya@example", "ma ya@example.com", ""]) {
      const { status } = await post("/register", { ...validSignup, email });
      expect(status).toBe(400);
    }
    expect(users.create).not.toHaveBeenCalled();
  });

  it("[AUTH-06] should reject the signup with 400 when the password is shorter than 8 characters", async () => {
    const { status, body } = await post("/register", { ...validSignup, password: "short12" });

    expect(status).toBe(400);
    expect(body.error).toMatch(/at least 8/);
    expect(users.create).not.toHaveBeenCalled();
  });

  it("[AUTH-07] should reject the signup with 400 when the username is too short, too long, or has symbols", async () => {
    for (const username of ["ab", "a".repeat(25), "maya!", "maya chen"]) {
      const { status } = await post("/register", { ...validSignup, username });
      expect(status).toBe(400);
    }
    expect(users.create).not.toHaveBeenCalled();
  });

  it("[AUTH-08] should reject the signup with 409 when the email is already registered", async () => {
    users.findOne.mockReturnValue(query(fakeUser()) as never);

    const { status } = await post("/register", validSignup);

    expect(status).toBe(409);
    expect(users.create).not.toHaveBeenCalled();
  });
});

describe("POST /auth/login", () => {
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash("correct-horse", 4);
  });

  it("[AUTH-09] should return a token when the email and password are correct", async () => {
    users.findOne.mockReturnValue(query(fakeUser({ passwordHash })) as never);

    const { status, body } = await post("/login", { emailOrUsername: "MAYA@example.com", password: "correct-horse" });

    expect(status).toBe(200);
    expect(jwt.verify(body.token, "test-secret")).toMatchObject({ sub: "user-123" });
    expect(body.user).not.toHaveProperty("passwordHash");
  });

  it("[AUTH-10] should return the same 401 error for a wrong password and for an unknown account", async () => {
    users.findOne.mockReturnValueOnce(query(fakeUser({ passwordHash })) as never);
    const wrongPassword = await post("/login", { emailOrUsername: "maya", password: "wrong-password" });

    users.findOne.mockReturnValueOnce(query(null) as never);
    const unknownUser = await post("/login", { emailOrUsername: "nobody", password: "correct-horse" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body.error).toBe(unknownUser.body.error);
  });
});
