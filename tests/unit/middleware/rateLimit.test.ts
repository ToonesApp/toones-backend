import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteAccountLimiter,
  deleteSoundLimiter,
  loginLimiter,
  registerLimiter
} from "../../../src/middleware/rateLimit.js";

let server: Server;
let baseUrl: string;

/** Sends a request as if it came from `ip`, the way Render forwards the client address. */
async function post(path: string, ip: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

beforeAll(async () => {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  // Stand-in handlers: the limiters are what is under test, not the auth logic.
  app.post("/login", loginLimiter, (req, res) => {
    res.status(req.body.correct ? 200 : 401).json({});
  });
  app.post("/register", registerLimiter, (_req, res) => {
    res.status(201).json({});
  });
  app.post("/delete-account", deleteAccountLimiter, (req, res) => {
    res.status(req.body.correct ? 200 : 403).json({});
  });
  app.post("/delete-sound", deleteSoundLimiter, (_req, res) => {
    res.status(200).json({});
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe("auth rate limits", () => {
  it("[RATE-01] should block the 11th failed login from the same IP with a 429 JSON error", async () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect((await post("/login", "203.0.113.1")).status).toBe(401);
    }

    const blocked = await post("/login", "203.0.113.1", { correct: true });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many login attempts/i);
  });

  it("[RATE-02] should not count successful logins, so a real user is never locked out", async () => {
    for (let attempt = 1; attempt <= 15; attempt += 1) {
      expect((await post("/login", "203.0.113.2", { correct: true })).status).toBe(200);
    }

    expect((await post("/login", "203.0.113.2")).status).toBe(401);
  });

  it("[RATE-03] should block the 6th sign-up from the same IP but not sign-ups from other IPs", async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await post("/register", "203.0.113.3")).status).toBe(201);
    }

    expect((await post("/register", "203.0.113.3")).status).toBe(429);
    expect((await post("/register", "203.0.113.4")).status).toBe(201);
  });

  it("[RATE-04] should block the 6th wrong password on account delete, even when the next one is right", async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await post("/delete-account", "203.0.113.5")).status).toBe(403);
    }

    const blocked = await post("/delete-account", "203.0.113.5", { correct: true });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many attempts to delete/i);
  });

  it("[RATE-05] should allow 60 drop deletes from one IP in 15 minutes and block the 61st", async () => {
    for (let attempt = 1; attempt <= 60; attempt += 1) {
      expect((await post("/delete-sound", "203.0.113.6")).status).toBe(200);
    }

    expect((await post("/delete-sound", "203.0.113.6")).status).toBe(429);
  });
});
