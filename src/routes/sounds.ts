import { Router } from "express";
import mongoose, { type Types } from "mongoose";

import { XP_PER_DROP, XP_PER_LISTEN, levelFromXp } from "../lib/xp.js";
import { optionalAuth, requireAuth } from "../middleware/requireAuth.js";
import { requireMongo } from "../middleware/requireMongo.js";
import { ListenModel } from "../models/Listen.js";
import { SoundModel, soundCategories, type Sound, type SoundCategory } from "../models/Sound.js";
import { UserModel } from "../models/User.js";

const router = Router();
router.use(requireMongo);

const defaultLimit = 200;
const maxLimit = 500;
const defaultRadiusKm = 50;
const maxRadiusKm = 20000;

type SoundAuthor = { _id: Types.ObjectId; username: string; displayName: string };
type SoundWithAuthor = Omit<Sound, "userId"> & {
  _id: Types.ObjectId;
  userId: SoundAuthor | Types.ObjectId | null;
};

type CreateSoundBody = {
  title?: unknown;
  description?: unknown;
  cat?: unknown;
  category?: unknown;
  dur?: unknown;
  durationSec?: unknown;
  lon?: unknown;
  lat?: unknown;
  place?: unknown;
  placeName?: unknown;
  audioUrl?: unknown;
  tags?: unknown;
};

function parseCategory(value: unknown): SoundCategory | null {
  const lowered = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (soundCategories as readonly string[]).includes(lowered) ? (lowered as SoundCategory) : null;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberParam(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isAuthor(value: SoundWithAuthor["userId"]): value is SoundAuthor {
  return value !== null && typeof value === "object" && "username" in value;
}

/** Matches the frontend's Drop shape (toones-app/src/features/home/homeStore.ts). */
function toDrop(sound: SoundWithAuthor, listened: boolean) {
  const [lon, lat] = sound.location.coordinates;
  const author = isAuthor(sound.userId)
    ? {
        id: sound.userId._id.toString(),
        username: sound.userId.username,
        displayName: sound.userId.displayName
      }
    : null;

  return {
    id: sound._id.toString(),
    title: sound.title,
    description: sound.description ?? null,
    cat: capitalize(sound.category),
    dur: sound.durationSec,
    when: sound.createdAt.getTime(),
    lon,
    lat,
    place: sound.placeName ?? "Open water",
    tags: sound.tags,
    audioUrl: sound.audioUrl ?? null,
    playCount: sound.playCount,
    listened,
    author
  };
}

async function listenedSoundIds(userId: string | undefined, soundIds: Types.ObjectId[]): Promise<Set<string>> {
  if (!userId || soundIds.length === 0) {
    return new Set();
  }

  const listens = await ListenModel.find({ userId, soundId: { $in: soundIds } }).select("soundId").lean();
  return new Set(listens.map((listen) => listen.soundId.toString()));
}

router.get("/", optionalAuth, async (req, res) => {
  const filter: Record<string, unknown> = {};

  if (typeof req.query.category === "string" && req.query.category.trim()) {
    const categories = req.query.category.split(",").map(parseCategory);

    if (categories.some((category) => category === null)) {
      res.status(400).json({ error: `category must be one of: ${soundCategories.join(", ")}.` });
      return;
    }

    filter.category = { $in: categories };
  }

  if (req.query.user !== undefined) {
    if (!mongoose.isValidObjectId(req.query.user)) {
      res.status(400).json({ error: "user must be a valid user id." });
      return;
    }

    filter.userId = req.query.user;
  }

  const lon = numberParam(req.query.lon);
  const lat = numberParam(req.query.lat);
  const isNearQuery = req.query.lon !== undefined || req.query.lat !== undefined;

  if (isNearQuery) {
    if (lon === null || lat === null || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      res.status(400).json({ error: "lon and lat must both be valid coordinates." });
      return;
    }

    const radiusKm = Math.min(numberParam(req.query.radiusKm) ?? defaultRadiusKm, maxRadiusKm);

    if (radiusKm <= 0) {
      res.status(400).json({ error: "radiusKm must be greater than 0." });
      return;
    }

    filter.location = {
      $nearSphere: {
        $geometry: { type: "Point", coordinates: [lon, lat] },
        $maxDistance: radiusKm * 1000
      }
    };
  }

  const limit = Math.min(Math.max(Math.trunc(numberParam(req.query.limit) ?? defaultLimit), 1), maxLimit);

  try {
    // $nearSphere already sorts by distance; any other query is newest first.
    const query = SoundModel.find(filter).limit(limit).populate("userId", "username displayName");
    const sounds = (await (isNearQuery ? query : query.sort({ createdAt: -1 })).lean()) as SoundWithAuthor[];
    const listened = await listenedSoundIds(
      req.auth?.userId,
      sounds.map((sound) => sound._id)
    );

    res.status(200).json({
      sounds: sounds.map((sound) => toDrop(sound, listened.has(sound._id.toString())))
    });
  } catch {
    res.status(500).json({ error: "Could not load sounds." });
  }
});

router.get("/:id", optionalAuth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: "Sound not found." });
    return;
  }

  try {
    const sound = (await SoundModel.findById(req.params.id)
      .populate("userId", "username displayName")
      .lean()) as SoundWithAuthor | null;

    if (!sound) {
      res.status(404).json({ error: "Sound not found." });
      return;
    }

    const listened = await listenedSoundIds(req.auth?.userId, [sound._id]);
    res.status(200).json({ sound: toDrop(sound, listened.has(sound._id.toString())) });
  } catch {
    res.status(500).json({ error: "Could not load sound." });
  }
});

router.post("/", requireAuth, async (req, res) => {
  const body = req.body as CreateSoundBody;
  const title = optionalText(body.title) ?? "Untitled Toone";
  const category = parseCategory(body.cat ?? body.category);
  const durationSec = numberParam(body.dur ?? body.durationSec);
  const lon = numberParam(body.lon);
  const lat = numberParam(body.lat);

  if (!category) {
    res.status(400).json({ error: `cat must be one of: ${soundCategories.join(", ")}.` });
    return;
  }

  if (durationSec === null || durationSec < 1 || durationSec > 60) {
    res.status(400).json({ error: "dur must be between 1 and 60 seconds." });
    return;
  }

  if (lon === null || lat === null) {
    res.status(400).json({ error: "lon and lat are required." });
    return;
  }

  const tags = Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : [];

  try {
    const created = await SoundModel.create({
      userId: req.auth?.userId,
      title,
      description: optionalText(body.description),
      audioUrl: optionalText(body.audioUrl),
      durationSec: Math.round(durationSec),
      category,
      tags,
      location: { type: "Point", coordinates: [lon, lat] },
      placeName: optionalText(body.place ?? body.placeName)
    });

    const user = await UserModel.findByIdAndUpdate(
      req.auth?.userId,
      { $inc: { xp: XP_PER_DROP } },
      { new: true }
    ).select("username displayName xp");

    if (!user) {
      await created.deleteOne();
      res.status(404).json({ error: "User not found." });
      return;
    }

    const sound = { ...created.toObject(), userId: user } as unknown as SoundWithAuthor;
    res.status(201).json({
      sound: toDrop(sound, false),
      xp: user.xp,
      level: levelFromXp(user.xp)
    });
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError) {
      res.status(400).json({ error: Object.values(error.errors)[0]?.message ?? "Invalid sound." });
      return;
    }

    res.status(500).json({ error: "Could not save sound." });
  }
});

router.post("/:id/listen", requireAuth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: "Sound not found." });
    return;
  }

  try {
    const sound = await SoundModel.findByIdAndUpdate(
      req.params.id,
      { $inc: { playCount: 1 } },
      { new: true }
    ).select("playCount");

    if (!sound) {
      res.status(404).json({ error: "Sound not found." });
      return;
    }

    let firstListen = false;

    try {
      const result = await ListenModel.updateOne(
        { userId: req.auth?.userId, soundId: sound._id },
        { $setOnInsert: { userId: req.auth?.userId, soundId: sound._id } },
        { upsert: true }
      );
      firstListen = result.upsertedCount === 1;
    } catch (error) {
      // Two simultaneous first plays race on the unique index; the loser is a repeat listen.
      if ((error as { code?: number }).code !== 11000) {
        throw error;
      }
    }

    const user = firstListen
      ? await UserModel.findByIdAndUpdate(req.auth?.userId, { $inc: { xp: XP_PER_LISTEN } }, { new: true })
      : await UserModel.findById(req.auth?.userId);

    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    res.status(200).json({
      firstListen,
      playCount: sound.playCount,
      xp: user.xp,
      level: levelFromXp(user.xp)
    });
  } catch {
    res.status(500).json({ error: "Could not record listen." });
  }
});

export default router;
