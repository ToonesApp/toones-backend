import { Router, type Response } from "express";
import mongoose from "mongoose";

import { levelFromXp } from "../lib/xp.js";
import { optionalAuth, requireAuth } from "../middleware/requireAuth.js";
import { requireMongo } from "../middleware/requireMongo.js";
import { FollowModel } from "../models/Follow.js";
import { SoundModel } from "../models/Sound.js";
import { UserModel } from "../models/User.js";

const router = Router();
router.use(requireMongo);

const maxListSize = 200;

type ProfileSource = {
  _id: mongoose.Types.ObjectId;
  username: string;
  displayName: string;
  xp?: number;
};

function profileSummary(user: ProfileSource) {
  const xp = user.xp ?? 0;
  return {
    id: user._id.toString(),
    username: user.username,
    displayName: user.displayName,
    xp,
    level: levelFromXp(xp)
  };
}

function rejectInvalidId(id: string, res: Response): boolean {
  if (mongoose.isValidObjectId(id)) {
    return false;
  }

  res.status(404).json({ error: "User not found." });
  return true;
}

router.get("/:id", optionalAuth, async (req, res) => {
  if (rejectInvalidId(req.params.id, res)) {
    return;
  }

  try {
    const user = await UserModel.findById(req.params.id).select("username displayName xp createdAt").lean();

    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const [soundCount, followerCount, followingCount, isFollowing] = await Promise.all([
      SoundModel.countDocuments({ userId: user._id }),
      FollowModel.countDocuments({ followingId: user._id }),
      FollowModel.countDocuments({ followerId: user._id }),
      req.auth ? FollowModel.exists({ followerId: req.auth.userId, followingId: user._id }) : null
    ]);

    res.status(200).json({
      user: {
        ...profileSummary(user),
        createdAt: user.createdAt.toISOString(),
        soundCount,
        followerCount,
        followingCount,
        isFollowing: Boolean(isFollowing)
      }
    });
  } catch {
    res.status(500).json({ error: "Could not load user." });
  }
});

router.post("/:id/follow", requireAuth, async (req, res) => {
  if (rejectInvalidId(req.params.id, res)) {
    return;
  }

  if (req.params.id === req.auth?.userId) {
    res.status(400).json({ error: "You cannot follow yourself." });
    return;
  }

  try {
    if (!(await UserModel.exists({ _id: req.params.id }))) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    await FollowModel.updateOne(
      { followerId: req.auth?.userId, followingId: req.params.id },
      { $setOnInsert: { followerId: req.auth?.userId, followingId: req.params.id } },
      { upsert: true }
    );

    res.status(200).json({ following: true });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      res.status(200).json({ following: true });
      return;
    }

    res.status(500).json({ error: "Could not follow user." });
  }
});

router.delete("/:id/follow", requireAuth, async (req, res) => {
  if (rejectInvalidId(req.params.id, res)) {
    return;
  }

  try {
    await FollowModel.deleteOne({ followerId: req.auth?.userId, followingId: req.params.id });
    res.status(200).json({ following: false });
  } catch {
    res.status(500).json({ error: "Could not unfollow user." });
  }
});

async function listConnections(
  req: { params: { id: string } },
  res: Response,
  direction: "followers" | "following"
): Promise<void> {
  if (rejectInvalidId(req.params.id, res)) {
    return;
  }

  const [matchField, userField] =
    direction === "followers" ? ["followingId", "followerId"] : ["followerId", "followingId"];

  try {
    const follows = await FollowModel.find({ [matchField]: req.params.id })
      .sort({ createdAt: -1 })
      .limit(maxListSize)
      .populate(userField, "username displayName xp")
      .lean();

    const users = follows
      .map((follow) => (follow as unknown as Record<string, ProfileSource | null>)[userField])
      .filter((user): user is ProfileSource => user !== null && typeof user === "object" && "username" in user)
      .map(profileSummary);

    res.status(200).json({ users });
  } catch {
    res.status(500).json({ error: `Could not load ${direction}.` });
  }
}

router.get("/:id/followers", (req, res) => listConnections(req, res, "followers"));
router.get("/:id/following", (req, res) => listConnections(req, res, "following"));

export default router;
