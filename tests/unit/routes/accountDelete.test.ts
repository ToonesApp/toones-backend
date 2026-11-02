import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import bcrypt from "bcrypt";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/env.js", () => ({ env: { jwtSecret: "test-secret" } }));
vi.mock("../../../src/db/connect.js", () => ({ isMongoConnected: () => true }));
vi.mock("../../../src/models/User.js", () => ({ UserModel: { findById: vi.fn(), deleteOne: vi.fn() } }));
vi.mock("../../../src/models/Sound.js", async (original) => ({
  ...(await original<object>()),
  SoundModel: { find: vi.fn() }
}));
vi.mock("../../../src/models/Listen.js", () => ({ ListenModel: { deleteMany: vi.fn() } }));
vi.mock("../../../src/models/Follow.js", () => ({ FollowModel: { deleteMany: vi.fn() } }));
vi.mock("../../../src/models/PasswordReset.js", () => ({ PasswordResetModel: { deleteMany: vi.fn() } }));
vi.mock("../../../src/models/EmailVerification.js", () => ({ EmailVerificationModel: { deleteMany: vi.fn() } }));
vi.mock("../../../src/lib/removeSounds.js", () => ({ removeSounds: vi.fn() }));

const { UserModel } = await import("../../../src/models/User.js");
const { SoundModel } = await import("../../../src/models/Sound.js");
const { ListenModel } = await import("../../../src/models/Listen.js");
const { FollowModel } = await import("../../../src/models/Follow.js");
const { PasswordResetModel } = await import("../../../src/models/PasswordReset.js");
const { EmailVerificationModel } = await import("../../../src/models/EmailVerification.js");
const { removeSounds } = await import("../../../src/lib/removeSounds.js");
const { default: authRouter } = await import("../../../src/routes/auth.js");

const users = vi.mocked(UserModel);
const sounds = vi.mocked(SoundModel);
const listens = vi.mocked(ListenModel);
const follows = vi.mocked(FollowModel);

const userId = new mongoose.Types.ObjectId();
const token = jwt.sign({}, "test-secret", { subject: userId.toString() });
const userSounds = [{ _id: new mongoose.Types.ObjectId() }];
let passwordHash: string;

let server: Server;
let baseUrl: string;

async function deleteAccount(body: object, auth = true) {
  const res = await fetch(`${baseUrl}/auth/me`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function userWith(hash?: string) {
  users.findById.mockReturnValue({ select: () => Promise.resolve({ _id: userId, passwordHash: hash }) } as never);
}

function expectNothingDeleted() {
  expect(removeSounds).not.toHaveBeenCalled();
  expect(listens.deleteMany).not.toHaveBeenCalled();
  expect(follows.deleteMany).not.toHaveBeenCalled();
  expect(users.deleteOne).not.toHaveBeenCalled();
}

beforeAll(async () => {
  passwordHash = await bcrypt.hash("correct horse", 4);
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
  userWith(passwordHash);
  sounds.find.mockReturnValue({ lean: () => Promise.resolve(userSounds) } as never);
});

describe("DELETE /auth/me", () => {
  it("[ACC-01] should delete the account with its drops, listens, and friend links when the password is correct", async () => {
    const { status, body } = await deleteAccount({ password: "correct horse" });

    expect(status).toBe(200);
    expect(body).toEqual({ deleted: true });
    expect(sounds.find).toHaveBeenCalledWith({ userId }, "audioFileId photos");
    expect(removeSounds).toHaveBeenCalledWith(userSounds);
    expect(listens.deleteMany).toHaveBeenCalledWith({ userId });
    expect(follows.deleteMany).toHaveBeenCalledWith({ $or: [{ followerId: userId }, { followingId: userId }] });
    expect(users.deleteOne).toHaveBeenCalledWith({ _id: userId });
  });

  it("should also void outstanding password reset and email verification links", async () => {
    await deleteAccount({ password: "correct horse" });

    expect(PasswordResetModel.deleteMany).toHaveBeenCalledWith({ userId });
    expect(EmailVerificationModel.deleteMany).toHaveBeenCalledWith({ userId });
  });

  it("[ACC-02] should delete the user record last so a failure part-way never leaves orphaned drops", async () => {
    await deleteAccount({ password: "correct horse" });

    const userDeletedAt = users.deleteOne.mock.invocationCallOrder[0];
    for (const step of [vi.mocked(removeSounds), listens.deleteMany, follows.deleteMany]) {
      expect(step.mock.invocationCallOrder[0]).toBeLessThan(userDeletedAt);
    }
  });

  it("[ACC-03] should refuse with 403 and delete nothing when the password is wrong", async () => {
    const { status } = await deleteAccount({ password: "wrong password" });

    expect(status).toBe(403);
    expectNothingDeleted();
  });

  it("[ACC-04] should refuse with 400 and delete nothing when a password account sends no password", async () => {
    const { status } = await deleteAccount({});

    expect(status).toBe(400);
    expectNothingDeleted();
  });

  it("[ACC-05] should delete a Google-only account without a password", async () => {
    userWith(undefined);

    const { status } = await deleteAccount({});

    expect(status).toBe(200);
    expect(users.deleteOne).toHaveBeenCalledWith({ _id: userId });
  });

  it("[ACC-06] should return 401 and delete nothing when the request has no login token", async () => {
    const { status } = await deleteAccount({ password: "correct horse" }, false);

    expect(status).toBe(401);
    expect(users.findById).not.toHaveBeenCalled();
    expectNothingDeleted();
  });
});
