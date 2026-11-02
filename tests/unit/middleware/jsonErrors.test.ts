import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { jsonBodyErrors } from "../../../src/middleware/jsonErrors.js";

let server: Server;
let baseUrl: string;

async function postRaw(body: string) {
  const res = await fetch(`${baseUrl}/echo`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  return { status: res.status, type: res.headers.get("content-type") ?? "", body: await res.text() };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.post("/echo", (req, res) => {
    res.json(req.body);
  });
  app.use(jsonBodyErrors);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe("jsonBodyErrors", () => {
  it("[VAL-01] should answer a malformed JSON body with a 400 JSON error instead of an HTML page", async () => {
    const res = await postRaw('{"email": "maya@example.com",');

    expect(res.status).toBe(400);
    expect(res.type).toMatch(/application\/json/);
    expect(JSON.parse(res.body)).toEqual({ error: "Request body must be valid JSON." });
  });

  it("[VAL-02] should answer a body over the size limit with a 413 JSON error", async () => {
    const res = await postRaw(JSON.stringify({ password: "a".repeat(200 * 1024) }));

    expect(res.status).toBe(413);
    expect(JSON.parse(res.body)).toEqual({ error: "Request body is too large." });
  });
});
