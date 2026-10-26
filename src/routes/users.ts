import { Router, type Response } from "express";
import mongoose from "mongoose";

import { isMongoConnected } from "../db/connect.js";
import { plainLook, type Look } from "../lib/look.js";
import { levelFromXp } from "../lib/xp.js";
import { optionalAuth } from "../middleware/requireAuth.js";
import { FollowModel } from "../models/Follow.js";
import { SoundModel } from "../models/Sound.js";
import { UserModel } from "../models/User.js";

const router = Router();

const recentSoundLimit = 20;

type ProfileSource = {
  _id: mongoose.Types.ObjectId;
  username: string;
  displayName: string;
  xp: number;
  look?: Look;
  bio?: string;
  createdAt: Date;
};

type SoundRow = {
  _id: mongoose.Types.ObjectId;
  title: string;
  category: string;
  durationSec: number;
  placeName?: string;
  playCount: number;
  createdAt: Date;
};

function ensureMongo(res: Response): boolean {
  if (isMongoConnected()) {
    return true;
  }

  res.status(503).json({ error: "Database is not connected." });
  return false;
}

/**
 * Anyone's public profile by username. Only safe fields are returned: no email and no raw xp.
 * When the caller is signed in it also says how the two of you are connected.
 */
router.get("/:username", optionalAuth, async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  const username = String(req.params.username ?? "").trim().toLowerCase().replace(/^@/, "");

  try {
    const user = (await UserModel.findOne({ username }, "username displayName xp look bio createdAt").lean()) as unknown as ProfileSource | null;

    if (!user) {
      res.status(404).json({ error: "No one has that username." });
      return;
    }

    const me = req.auth?.userId;
    const [posts, following, followers, sounds, mine, theirs] = await Promise.all([
      SoundModel.countDocuments({ userId: user._id }),
      FollowModel.countDocuments({ followerId: user._id }),
      FollowModel.countDocuments({ followingId: user._id }),
      SoundModel.find({ userId: user._id }, "title category durationSec placeName playCount createdAt")
        .sort({ createdAt: -1 })
        .limit(recentSoundLimit)
        .lean() as unknown as Promise<SoundRow[]>,
      me ? FollowModel.exists({ followerId: me, followingId: user._id }) : null,
      me ? FollowModel.exists({ followerId: user._id, followingId: me }) : null
    ]);

    res.status(200).json({
      profile: {
        id: user._id.toString(),
        username: user.username,
        displayName: user.displayName,
        level: levelFromXp(user.xp ?? 0),
        look: user.look ? plainLook(user.look) : null,
        bio: user.bio ?? "",
        joinedAt: user.createdAt.toISOString(),
        posts,
        following,
        followers,
        isMe: !!me && me === user._id.toString(),
        youFollow: !!mine,
        followsYou: !!theirs,
        sounds: sounds.map((sound) => ({
          id: sound._id.toString(),
          title: sound.title,
          category: sound.category,
          durationSec: sound.durationSec,
          placeName: sound.placeName ?? "",
          playCount: sound.playCount,
          createdAt: sound.createdAt.toISOString()
        }))
      }
    });
  } catch {
    res.status(500).json({ error: "Could not load that profile." });
  }
});

export default router;
