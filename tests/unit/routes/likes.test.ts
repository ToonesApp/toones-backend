import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/env.js", () => ({ env: { jwtSecret: "test-secret" } }));
vi.mock("../../../src/db/connect.js", () => ({ isMongoConnected: () => true }));
vi.mock("../../../src/models/Sound.js", async (original) => ({
  ...(await original<object>()),
  SoundModel: { findById: vi.fn(), findByIdAndUpdate: vi.fn(), findOneAndUpdate: vi.fn(), find: vi.fn() }
}));
vi.mock("../../../src/models/Like.js", () => ({ LikeModel: { create: vi.fn(), deleteOne: vi.fn(), find: vi.fn() } }));
vi.mock("../../../src/models/Listen.js", () => ({ ListenModel: { find: vi.fn() } }));
vi.mock("../../../src/models/User.js", () => ({ UserModel: { find: vi.fn() } }));

const { SoundModel } = await import("../../../src/models/Sound.js");
const { LikeModel } = await import("../../../src/models/Like.js");
const { ListenModel } = await import("../../../src/models/Listen.js");
const { UserModel } = await import("../../../src/models/User.js");
const { default: soundsRouter } = await import("../../../src/routes/sounds.js");

const sounds = vi.mocked(SoundModel);
const likes = vi.mocked(LikeModel);

const { ObjectId } = mongoose.Types;
const userId = new ObjectId();
const soundId = new ObjectId();
const token = jwt.sign({}, "test-secret", { subject: userId.toString() });

const lean = (value: unknown) => ({ lean: () => Promise.resolve(value) }) as never;

let server: Server;
let baseUrl: string;

async function call(method: "PUT" | "DELETE" | "GET", path: string, auth = true) {
  const res = await fetch(`${baseUrl}/sounds${path}`, {
    method,
    headers: auth ? { Authorization: `Bearer ${token}` } : {}
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

function expectNoLikeWritten() {
  expect(likes.create).not.toHaveBeenCalled();
  expect(likes.deleteOne).not.toHaveBeenCalled();
  expect(sounds.findByIdAndUpdate).not.toHaveBeenCalled();
  expect(sounds.findOneAndUpdate).not.toHaveBeenCalled();
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/sounds", soundsRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  vi.resetAllMocks();
  sounds.findById.mockReturnValue(lean({ _id: soundId, likeCount: 2 }));
});

describe("PUT/DELETE /sounds/:id/like", () => {
  it("[LIKE-01] should save the like and add one to the drop's count", async () => {
    sounds.findByIdAndUpdate.mockReturnValue(lean({ likeCount: 3 }));

    const { status, body } = await call("PUT", `/${soundId}/like`);

    expect(status).toBe(200);
    expect(body).toEqual({ liked: true, likeCount: 3 });
    expect(likes.create).toHaveBeenCalledWith({ userId, soundId });
    expect(sounds.findByIdAndUpdate.mock.calls[0]?.[1]).toEqual({ $inc: { likeCount: 1 } });
  });

  it("[LIKE-02] should not count a second like from the same user (double-tap)", async () => {
    likes.create.mockRejectedValue(Object.assign(new Error("duplicate"), { code: 11000 }));

    const { status, body } = await call("PUT", `/${soundId}/like`);

    expect(status).toBe(200);
    expect(body).toEqual({ liked: true, likeCount: 2 });
    expect(sounds.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("[LIKE-03] should remove the like and subtract one, never below 0", async () => {
    likes.deleteOne.mockResolvedValue({ deletedCount: 1 } as never);
    sounds.findOneAndUpdate.mockReturnValue(lean({ likeCount: 1 }));

    const { status, body } = await call("DELETE", `/${soundId}/like`);

    expect(status).toBe(200);
    expect(body).toEqual({ liked: false, likeCount: 1 });
    expect(likes.deleteOne).toHaveBeenCalledWith({ userId, soundId });
    const [filter, update] = sounds.findOneAndUpdate.mock.calls[0] as unknown as [Record<string, unknown>, unknown];
    expect(filter.likeCount).toEqual({ $gt: 0 });
    expect(update).toEqual({ $inc: { likeCount: -1 } });
  });

  it("[LIKE-04] should leave the count alone when unliking a drop the user never liked", async () => {
    likes.deleteOne.mockResolvedValue({ deletedCount: 0 } as never);

    const { status, body } = await call("DELETE", `/${soundId}/like`);

    expect(status).toBe(200);
    expect(body).toEqual({ liked: false, likeCount: 2 });
    expect(sounds.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("[LIKE-05] should return 404 and write nothing when the drop does not exist or the id is invalid", async () => {
    sounds.findById.mockReturnValue(lean(null));

    for (const method of ["PUT", "DELETE"] as const) {
      expect((await call(method, `/${new ObjectId()}/like`)).status).toBe(404);
      expect((await call(method, "/not-an-id/like")).status).toBe(404);
    }
    expectNoLikeWritten();
  });

  it("[LIKE-06] should return 401 and write nothing when the request has no login token", async () => {
    for (const method of ["PUT", "DELETE"] as const) {
      expect((await call(method, `/${soundId}/like`, false)).status).toBe(401);
    }
    expect(sounds.findById).not.toHaveBeenCalled();
    expectNoLikeWritten();
  });
});

describe("GET /sounds like fields", () => {
  const base = {
    userId: new ObjectId(),
    title: "Birds",
    audioUrl: "/sounds/x/audio",
    durationSec: 10,
    category: "nature",
    tags: [],
    location: { coordinates: [0, 0] },
    playCount: 0,
    createdAt: new Date("2026-11-01T00:00:00Z")
  };
  const likedSound = { ...base, _id: new ObjectId(), likeCount: 5 };
  const olderSound = { ...base, _id: new ObjectId() };

  beforeEach(() => {
    sounds.find.mockReturnValue({ sort: () => ({ limit: () => lean([likedSound, olderSound]) }) } as never);
    vi.mocked(UserModel.find).mockReturnValue(lean([]));
    vi.mocked(ListenModel.find).mockReturnValue(lean([]));
    likes.find.mockReturnValue(lean([{ soundId: likedSound._id }]));
  });

  it("[LIKE-07] should show each drop's like count and whether the signed-in user liked it", async () => {
    const { status, body } = await call("GET", "/");

    expect(status).toBe(200);
    expect(body.sounds.map((s: any) => [s.likeCount, s.liked])).toEqual([
      [5, true],
      [0, false]
    ]);
  });

  it("[LIKE-08] should show counts but liked=false for everyone when signed out", async () => {
    const { body } = await call("GET", "/", false);

    expect(body.sounds.map((s: any) => [s.likeCount, s.liked])).toEqual([
      [5, false],
      [0, false]
    ]);
    expect(likes.find).not.toHaveBeenCalled();
  });
});
