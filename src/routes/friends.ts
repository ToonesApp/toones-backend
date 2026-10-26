import { Router, type Response } from "express";
import mongoose from "mongoose";

import { isMongoConnected } from "../db/connect.js";
import { plainLook, type Look } from "../lib/look.js";
import { levelFromXp } from "../lib/xp.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { FollowModel } from "../models/Follow.js";
import { UserModel } from "../models/User.js";

const router = Router();

const minQueryLength = 2;
const maxResults = 20;

type PersonSource = {
  _id: mongoose.Types.ObjectId;
  username: string;
  displayName: string;
  xp: number;
  look?: Look;
};

function ensureMongo(res: Response): boolean {
  if (isMongoConnected()) {
    return true;
  }

  res.status(503).json({ error: "Database is not connected." });
  return false;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Who `me` follows, and who follows `me`, among the given people. */
async function relations(me: string, ids: mongoose.Types.ObjectId[]) {
  const [following, followers] = await Promise.all([
    FollowModel.find({ followerId: me, followingId: { $in: ids } }, "followingId").lean(),
    FollowModel.find({ followingId: me, followerId: { $in: ids } }, "followerId").lean()
  ]);

  return {
    following: new Set(following.map((row) => row.followingId.toString())),
    followsYou: new Set(followers.map((row) => row.followerId.toString()))
  };
}

function publicPerson(
  user: PersonSource,
  rel: { following: Set<string>; followsYou: Set<string> }
) {
  const id = user._id.toString();

  return {
    id,
    username: user.username,
    displayName: user.displayName,
    level: levelFromXp(user.xp ?? 0),
    look: user.look ? plainLook(user.look) : null,
    following: rel.following.has(id),
    followsYou: rel.followsYou.has(id)
  };
}

const personFields = "username displayName xp look";

/** Everyone the signed-in user follows, and everyone who follows them. */
router.get("/", requireAuth, async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  const me = req.auth?.userId;

  if (!me) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }

  try {
    const [outgoing, incoming] = await Promise.all([
      FollowModel.find({ followerId: me }).sort({ createdAt: -1 }).lean(),
      FollowModel.find({ followingId: me }).sort({ createdAt: -1 }).lean()
    ]);

    const ids = [
      ...new Set([...outgoing.map((row) => row.followingId.toString()), ...incoming.map((row) => row.followerId.toString())])
    ].map((id) => new mongoose.Types.ObjectId(id));

    const users = (await UserModel.find({ _id: { $in: ids } }, personFields).lean()) as unknown as PersonSource[];
    const byId = new Map(users.map((user) => [user._id.toString(), user]));
    const rel = await relations(me, ids);

    const people = (list: mongoose.Types.ObjectId[]) =>
      list.flatMap((id) => {
        const user = byId.get(id.toString());
        return user ? [publicPerson(user, rel)] : [];
      });

    res.status(200).json({
      following: people(outgoing.map((row) => row.followingId)),
      followers: people(incoming.map((row) => row.followerId))
    });
  } catch {
    res.status(500).json({ error: "Could not load friends." });
  }
});

/** Find people by username or display name. `?q=` needs at least two characters; a leading @ is ignored. */
router.get("/search", requireAuth, async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  const me = req.auth?.userId;
  const query = (typeof req.query.q === "string" ? req.query.q : "").trim().replace(/^@/, "");

  if (!me || query.length < minQueryLength) {
    res.status(200).json({ people: [] });
    return;
  }

  try {
    const prefix = new RegExp(`^${escapeRegex(query)}`, "i");
    const users = (await UserModel.find(
      { _id: { $ne: me }, $or: [{ username: prefix }, { displayName: prefix }] },
      personFields
    )
      .sort({ username: 1 })
      .limit(maxResults)
      .lean()) as unknown as PersonSource[];

    const rel = await relations(
      me,
      users.map((user) => user._id)
    );

    res.status(200).json({ people: users.map((user) => publicPerson(user, rel)) });
  } catch {
    res.status(500).json({ error: "Could not search." });
  }
});

/** Follow someone by username. Safe to repeat. */
router.post("/:username", requireAuth, async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  const me = req.auth?.userId;
  const username = String(req.params.username ?? "").trim().toLowerCase().replace(/^@/, "");

  try {
    const target = (await UserModel.findOne({ username }, personFields).lean()) as unknown as PersonSource | null;

    if (!me || !target) {
      res.status(404).json({ error: "No one has that username." });
      return;
    }

    if (target._id.toString() === me) {
      res.status(400).json({ error: "You can't add yourself." });
      return;
    }

    await FollowModel.updateOne(
      { followerId: me, followingId: target._id },
      { $setOnInsert: { followerId: me, followingId: target._id } },
      { upsert: true }
    );

    res.status(200).json({ person: publicPerson(target, await relations(me, [target._id])) });
  } catch {
    res.status(500).json({ error: "Could not add friend." });
  }
});

/** Stop following someone by username. Safe to repeat. */
router.delete("/:username", requireAuth, async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  const me = req.auth?.userId;
  const username = String(req.params.username ?? "").trim().toLowerCase().replace(/^@/, "");

  try {
    const target = await UserModel.findOne({ username }, "_id").lean();

    if (!me || !target) {
      res.status(404).json({ error: "No one has that username." });
      return;
    }

    await FollowModel.deleteOne({ followerId: me, followingId: target._id });

    res.status(200).json({ ok: true });
  } catch {
    res.status(500).json({ error: "Could not remove friend." });
  }
});

export default router;
