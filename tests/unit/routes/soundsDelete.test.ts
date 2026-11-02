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
  SoundModel: { findById: vi.fn(), deleteMany: vi.fn() }
}));
vi.mock("../../../src/models/Listen.js", () => ({ ListenModel: { deleteMany: vi.fn() } }));
vi.mock("../../../src/models/User.js", () => ({ UserModel: { findByIdAndUpdate: vi.fn() } }));
vi.mock("../../../src/lib/audio.js", async (original) => ({ ...(await original<object>()), deleteAudio: vi.fn() }));
vi.mock("../../../src/lib/photo.js", async (original) => ({ ...(await original<object>()), deletePhoto: vi.fn() }));

const { SoundModel } = await import("../../../src/models/Sound.js");
const { ListenModel } = await import("../../../src/models/Listen.js");
const { UserModel } = await import("../../../src/models/User.js");
const { deleteAudio } = await import("../../../src/lib/audio.js");
const { deletePhoto } = await import("../../../src/lib/photo.js");
const { default: soundsRouter } = await import("../../../src/routes/sounds.js");

const sounds = vi.mocked(SoundModel);
const listens = vi.mocked(ListenModel);
const users = vi.mocked(UserModel);

const { ObjectId } = mongoose.Types;
const ownerId = new ObjectId();
const strangerId = new ObjectId();
const soundId = new ObjectId();
const audioFileId = new ObjectId();
const photoIds = [new ObjectId(), new ObjectId()];

const tokenFor = (id: mongoose.Types.ObjectId) => jwt.sign({}, "test-secret", { subject: id.toString() });

let server: Server;
let baseUrl: string;

async function del(path: string, token?: string) {
  const res = await fetch(`${baseUrl}/sounds${path}`, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

function expectNothingDeleted() {
  expect(sounds.deleteMany).not.toHaveBeenCalled();
  expect(listens.deleteMany).not.toHaveBeenCalled();
  expect(deleteAudio).not.toHaveBeenCalled();
  expect(deletePhoto).not.toHaveBeenCalled();
  expect(users.findByIdAndUpdate).not.toHaveBeenCalled();
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
  const sound = { _id: soundId, userId: ownerId, audioFileId, photos: photoIds.map((fileId) => ({ fileId })) };
  sounds.findById.mockReturnValue({ lean: () => Promise.resolve(sound) } as never);
  users.findByIdAndUpdate.mockResolvedValue({ xp: 60, level: 1 } as never);
});

describe("DELETE /sounds/:id", () => {
  it("[DEL-01] should delete the owner's drop with its listens, audio, and photos", async () => {
    const { status, body } = await del(`/${soundId}`, tokenFor(ownerId));

    expect(status).toBe(200);
    expect(body).toEqual({ deleted: true, xp: 60, level: 1 });
    expect(listens.deleteMany).toHaveBeenCalledWith({ soundId: { $in: [soundId] } });
    expect(sounds.deleteMany).toHaveBeenCalledWith({ _id: { $in: [soundId] } });
    expect(deleteAudio).toHaveBeenCalledWith(audioFileId);
    expect(deletePhoto).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deletePhoto).mock.calls.map(([id]) => id)).toEqual(photoIds);
  });

  it("[DEL-02] should take back the 40 drop XP without going below 0", async () => {
    await del(`/${soundId}`, tokenFor(ownerId));

    const [userId, update] = users.findByIdAndUpdate.mock.calls[0] as unknown as [mongoose.Types.ObjectId, unknown];
    expect(userId.equals(ownerId)).toBe(true);
    expect(update).toEqual([{ $set: { xp: { $max: [0, { $subtract: ["$xp", 40] }] } } }]);
  });

  it("[DEL-03] should refuse with 403 and delete nothing when someone else's drop is targeted", async () => {
    const { status } = await del(`/${soundId}`, tokenFor(strangerId));

    expect(status).toBe(403);
    expectNothingDeleted();
  });

  it("[DEL-04] should return 404 and delete nothing when the drop does not exist or the id is invalid", async () => {
    sounds.findById.mockReturnValue({ lean: () => Promise.resolve(null) } as never);

    expect((await del(`/${new ObjectId()}`, tokenFor(ownerId))).status).toBe(404);
    expect((await del("/not-an-id", tokenFor(ownerId))).status).toBe(404);
    expectNothingDeleted();
  });

  it("[DEL-05] should return 401 and delete nothing when the request has no login token", async () => {
    const { status } = await del(`/${soundId}`);

    expect(status).toBe(401);
    expect(sounds.findById).not.toHaveBeenCalled();
    expectNothingDeleted();
  });
});
