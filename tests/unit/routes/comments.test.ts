import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/env.js", () => ({ env: { jwtSecret: "test-secret" } }));
vi.mock("../../../src/db/connect.js", () => ({ isMongoConnected: () => true }));
vi.mock("../../../src/middleware/rateLimit.js", () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { commentLimiter: pass, commentsReadLimiter: pass };
});
vi.mock("../../../src/models/Sound.js", () => ({
  SoundModel: { findById: vi.fn(), findByIdAndUpdate: vi.fn(), findOneAndUpdate: vi.fn() }
}));
vi.mock("../../../src/models/Comment.js", async (original) => ({
  ...(await original<object>()),
  CommentModel: { find: vi.fn(), findOne: vi.fn(), create: vi.fn(), deleteOne: vi.fn() }
}));
vi.mock("../../../src/models/User.js", () => ({ UserModel: { find: vi.fn() } }));

const { SoundModel } = await import("../../../src/models/Sound.js");
const { CommentModel } = await import("../../../src/models/Comment.js");
const { UserModel } = await import("../../../src/models/User.js");
const { default: router } = await import("../../../src/routes/comments.js");

const sounds = vi.mocked(SoundModel);
const comments = vi.mocked(CommentModel);

const { ObjectId } = mongoose.Types;
const ownerId = new ObjectId();
const authorId = new ObjectId();
const strangerId = new ObjectId();
const soundId = new ObjectId();
const commentId = new ObjectId();

const tokenFor = (id: mongoose.Types.ObjectId) => jwt.sign({}, "test-secret", { subject: id.toString() });
const lean = <T>(value: T) => ({ lean: () => Promise.resolve(value) }) as never;
/** A Mongoose query that supports `.sort().limit().lean()`. */
const query = <T>(value: T) => ({ sort: () => ({ limit: () => ({ lean: () => Promise.resolve(value) }) }) }) as never;

let server: Server;
let baseUrl: string;

async function call(method: string, path: string, { token, body }: { token?: string; body?: unknown } = {}) {
  const res = await fetch(`${baseUrl}/sounds${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/sounds", router);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  vi.resetAllMocks();
  sounds.findById.mockReturnValue(lean({ _id: soundId, userId: ownerId, commentCount: 2 }));
  vi.mocked(UserModel.find).mockReturnValue(lean([{ _id: authorId, username: "maya", displayName: "Maya" }]));
});

describe("GET /sounds/:id/comments", () => {
  it("lists comments newest first with author info, publicly", async () => {
    const createdAt = new Date("2026-11-01T10:00:00Z");
    comments.find.mockReturnValue(query([{ _id: commentId, soundId, userId: authorId, text: "love this", createdAt }]));

    const { status, body } = await call("GET", `/${soundId}/comments`);

    expect(status).toBe(200);
    expect(body.commentCount).toBe(2);
    expect(body.comments).toEqual([
      {
        id: commentId.toString(),
        text: "love this",
        createdAt: createdAt.toISOString(),
        author: { id: authorId.toString(), username: "maya", displayName: "Maya", look: null },
        mine: false,
        canDelete: false
      }
    ]);
    expect(body.nextBefore).toBeNull();
  });

  it("marks comments the caller may delete", async () => {
    comments.find.mockReturnValue(query([{ _id: commentId, soundId, userId: authorId, text: "hi", createdAt: new Date() }]));

    const asAuthor = await call("GET", `/${soundId}/comments`, { token: tokenFor(authorId) });
    expect(asAuthor.body.comments[0]).toMatchObject({ mine: true, canDelete: true });

    const asOwner = await call("GET", `/${soundId}/comments`, { token: tokenFor(ownerId) });
    expect(asOwner.body.comments[0]).toMatchObject({ mine: false, canDelete: true });
  });

  it("returns 404 for an unknown or malformed sound id", async () => {
    sounds.findById.mockReturnValue(lean(null));
    expect((await call("GET", `/${new ObjectId()}/comments`)).status).toBe(404);
    expect((await call("GET", "/not-an-id/comments")).status).toBe(404);
  });
});

describe("POST /sounds/:id/comments", () => {
  it("requires sign-in", async () => {
    expect((await call("POST", `/${soundId}/comments`, { body: { text: "hi" } })).status).toBe(401);
    expect(comments.create).not.toHaveBeenCalled();
  });

  it("rejects empty and over-long comments", async () => {
    const token = tokenFor(authorId);
    expect((await call("POST", `/${soundId}/comments`, { token, body: { text: "   " } })).status).toBe(400);
    expect((await call("POST", `/${soundId}/comments`, { token, body: { text: "x".repeat(281) } })).status).toBe(400);
    expect(comments.create).not.toHaveBeenCalled();
  });

  it("saves a trimmed comment and bumps the sound's count", async () => {
    const createdAt = new Date();
    comments.create.mockResolvedValue({ toObject: () => ({ _id: commentId, soundId, userId: authorId, text: "great take", createdAt }) } as never);
    sounds.findByIdAndUpdate.mockReturnValue(lean({ commentCount: 3 }));

    const { status, body } = await call("POST", `/${soundId}/comments`, { token: tokenFor(authorId), body: { text: "  great take  " } });

    expect(status).toBe(201);
    expect(comments.create).toHaveBeenCalledWith({ soundId, userId: authorId, text: "great take" });
    expect(sounds.findByIdAndUpdate).toHaveBeenCalledWith(soundId, { $inc: { commentCount: 1 } }, expect.anything());
    expect(body.commentCount).toBe(3);
    expect(body.comment).toMatchObject({ id: commentId.toString(), text: "great take", mine: true, canDelete: true });
  });

  it("returns 404 when the sound doesn't exist", async () => {
    sounds.findById.mockReturnValue(lean(null));
    expect((await call("POST", `/${soundId}/comments`, { token: tokenFor(authorId), body: { text: "hi" } })).status).toBe(404);
  });
});

describe("DELETE /sounds/:id/comments/:commentId", () => {
  beforeEach(() => {
    comments.findOne.mockReturnValue(lean({ _id: commentId, userId: authorId }));
    comments.deleteOne.mockResolvedValue({ deletedCount: 1 } as never);
    sounds.findOneAndUpdate.mockReturnValue(lean({ commentCount: 1 }));
  });

  it("lets the author delete their comment and lowers the count without going below 0", async () => {
    const { status, body } = await call("DELETE", `/${soundId}/comments/${commentId}`, { token: tokenFor(authorId) });

    expect(status).toBe(200);
    expect(body).toEqual({ deleted: true, commentCount: 1 });
    expect(sounds.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: soundId, commentCount: { $gt: 0 } },
      { $inc: { commentCount: -1 } },
      expect.anything()
    );
  });

  it("lets the sound's owner remove someone else's comment", async () => {
    expect((await call("DELETE", `/${soundId}/comments/${commentId}`, { token: tokenFor(ownerId) })).status).toBe(200);
  });

  it("refuses anyone else with 403 and deletes nothing", async () => {
    const { status } = await call("DELETE", `/${soundId}/comments/${commentId}`, { token: tokenFor(strangerId) });

    expect(status).toBe(403);
    expect(comments.deleteOne).not.toHaveBeenCalled();
  });

  it("returns 404 for a comment that isn't on this sound", async () => {
    comments.findOne.mockReturnValue(lean(null));
    expect((await call("DELETE", `/${soundId}/comments/${commentId}`, { token: tokenFor(authorId) })).status).toBe(404);
  });
});
