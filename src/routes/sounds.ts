import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";
import multer from "multer";

import { isMongoConnected } from "../db/connect.js";
import { MAX_AUDIO_BYTES, audioLength, deleteAudio, normalizeAudioMime, openAudio, storeAudio } from "../lib/audio.js";
import { plainLook, type Look } from "../lib/look.js";
import { MAX_PHOTOS_PER_SOUND, MAX_PHOTO_BYTES, deletePhoto, openPhoto, photoLength, sniffImageMime, storePhoto } from "../lib/photo.js";
import { XP_PER_DROP, XP_PER_LISTEN } from "../lib/xp.js";
import { optionalAuth, requireAuth } from "../middleware/requireAuth.js";
import { ListenModel } from "../models/Listen.js";
import { SoundModel, soundCategories, type SoundCategory } from "../models/Sound.js";
import { UserModel } from "../models/User.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1 }
});

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 }
});

const defaultFeedLimit = 100;
const maxFeedLimit = 200;
const maxTags = 8;

type SoundLean = {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  audioUrl: string;
  durationSec: number;
  category: SoundCategory;
  tags: string[];
  location: { coordinates: [number, number] };
  placeName?: string;
  photos?: { fileId: mongoose.Types.ObjectId; mime: string }[];
  playCount: number;
  createdAt: Date;
};

type Author = { id: string; username: string; displayName: string; look: Look | null };

function ensureMongo(res: Response): boolean {
  if (isMongoConnected()) {
    return true;
  }

  res.status(503).json({ error: "Database is not connected." });
  return false;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isCategory(value: string): value is SoundCategory {
  return (soundCategories as readonly string[]).includes(value);
}

/** Absolute URL of this API as the client reached it (honors `trust proxy` on Render). */
function origin(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

function photoUrls(req: Request, sound: Pick<SoundLean, "_id" | "photos">): string[] {
  return (sound.photos ?? []).map((photo) => `${origin(req)}/sounds/${sound._id.toString()}/photos/${photo.fileId.toString()}`);
}

function publicSound(
  req: Request,
  sound: SoundLean,
  author: Author | undefined,
  listened: boolean
) {
  const [lon, lat] = sound.location.coordinates;

  return {
    id: sound._id.toString(),
    title: sound.title,
    description: sound.description ?? "",
    category: sound.category,
    tags: sound.tags,
    durationSec: sound.durationSec,
    lon,
    lat,
    placeName: sound.placeName ?? "",
    playCount: sound.playCount,
    // Audio stored by this API is saved as a relative path; make it absolute for the client.
    audioUrl: sound.audioUrl.startsWith("/") ? `${origin(req)}${sound.audioUrl}` : sound.audioUrl,
    photos: photoUrls(req, sound),
    createdAt: sound.createdAt.toISOString(),
    author: author ?? null,
    mine: req.auth?.userId === sound.userId.toString(),
    listened
  };
}

async function authorsById(ids: mongoose.Types.ObjectId[]): Promise<Map<string, Author>> {
  const users = await UserModel.find({ _id: { $in: ids } }, "username displayName look").lean();

  return new Map(
    users.map((user) => [
      user._id.toString(),
      {
        id: user._id.toString(),
        username: user.username,
        displayName: user.displayName,
        look: user.look ? plainLook(user.look) : null
      }
    ])
  );
}

/** Runs multer for one request and turns its errors into JSON responses. */
function receiveFile(
  req: Request,
  res: Response,
  receive: ReturnType<typeof upload.single>,
  tooLarge: string
): Promise<boolean> {
  return new Promise((resolve) => {
    receive(req, res, (error: unknown) => {
      if (!error) {
        resolve(true);
        return;
      }

      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: tooLarge });
      } else {
        res.status(400).json({ error: "Could not read the upload." });
      }

      resolve(false);
    });
  });
}

/** Create a sound: multipart form with an `audio` file plus title, category, lon, lat, durationSec. */
router.post("/", requireAuth, async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  if (!(await receiveFile(req, res, upload.single("audio"), `Audio must be under ${MAX_AUDIO_BYTES / (1024 * 1024)} MB.`))) {
    return;
  }

  const body = req.body as Record<string, unknown>;
  const title = text(body.title);
  const description = text(body.description);
  const placeName = text(body.placeName);
  const category = text(body.category).toLowerCase();
  const lon = Number(body.lon);
  const lat = Number(body.lat);
  const durationSec = Math.round(Number(body.durationSec));
  const tags = text(body.tags)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, maxTags);

  if (!req.file) {
    res.status(400).json({ error: "An audio file is required." });
    return;
  }

  const mime = normalizeAudioMime(req.file.mimetype);

  if (!mime) {
    res.status(400).json({ error: "Unsupported audio type." });
    return;
  }

  if (title.length < 1 || title.length > 80) {
    res.status(400).json({ error: "Title must be 1-80 characters." });
    return;
  }

  if (description.length > 280 || placeName.length > 120) {
    res.status(400).json({ error: "Description or place name is too long." });
    return;
  }

  if (!isCategory(category)) {
    res.status(400).json({ error: `Category must be one of: ${soundCategories.join(", ")}.` });
    return;
  }

  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
    res.status(400).json({ error: "A valid lon/lat location is required." });
    return;
  }

  if (!Number.isFinite(durationSec) || durationSec < 1 || durationSec > 60) {
    res.status(400).json({ error: "Duration must be 1-60 seconds." });
    return;
  }

  const userId = new mongoose.Types.ObjectId(req.auth?.userId);
  const soundId = new mongoose.Types.ObjectId();
  let audioFileId: mongoose.Types.ObjectId | undefined;

  try {
    audioFileId = await storeAudio(req.file.buffer, `${soundId.toString()}.${mime.split("/")[1]}`, mime);

    const sound = await SoundModel.create({
      _id: soundId,
      userId,
      title,
      description: description || undefined,
      audioUrl: `/sounds/${soundId.toString()}/audio`,
      audioFileId,
      audioMime: mime,
      durationSec,
      category,
      tags,
      location: { type: "Point", coordinates: [lon, lat] },
      placeName: placeName || undefined
    });

    const user = await UserModel.findByIdAndUpdate(userId, { $inc: { xp: XP_PER_DROP } }, { new: true });
    const authors = await authorsById([userId]);

    res.status(201).json({
      sound: publicSound(req, sound.toObject() as unknown as SoundLean, authors.get(userId.toString()), false),
      xp: user?.xp ?? 0,
      level: user?.level ?? 1
    });
  } catch {
    // Do not leave an orphaned audio file behind when the document could not be created.
    if (audioFileId) {
      await deleteAudio(audioFileId);
    }

    res.status(500).json({ error: "Could not save sound." });
  }
});

/**
 * The feed, newest first. Optional query: `category` (comma list), `limit`, `before` (ISO date cursor),
 * and `near=lon,lat` with `radiusKm` to restrict to a circle.
 */
router.get("/", optionalAuth, async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  const filter: Record<string, unknown> = {};

  const categories = text(req.query.category)
    .toLowerCase()
    .split(",")
    .map((value) => value.trim())
    .filter(isCategory);

  if (categories.length > 0) {
    filter.category = { $in: categories };
  }

  const before = new Date(text(req.query.before));

  if (!Number.isNaN(before.getTime())) {
    filter.createdAt = { $lt: before };
  }

  const near = text(req.query.near).split(",").map(Number);
  const radiusKm = Number(req.query.radiusKm);

  if (near.length === 2 && near.every(Number.isFinite) && Number.isFinite(radiusKm) && radiusKm > 0) {
    // $geoWithin keeps the createdAt ordering, unlike $near.
    filter.location = { $geoWithin: { $centerSphere: [near, radiusKm / 6378.1] } };
  }

  const requested = Number(req.query.limit);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.floor(requested), 1), maxFeedLimit) : defaultFeedLimit;

  try {
    const sounds = (await SoundModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean()) as unknown as SoundLean[];
    const authors = await authorsById([...new Set(sounds.map((sound) => sound.userId.toString()))].map((id) => new mongoose.Types.ObjectId(id)));

    const listened = new Set<string>();

    if (req.auth?.userId && sounds.length > 0) {
      const listens = await ListenModel.find(
        { userId: req.auth.userId, soundId: { $in: sounds.map((sound) => sound._id) } },
        "soundId"
      ).lean();

      for (const listen of listens) {
        listened.add(listen.soundId.toString());
      }
    }

    const last = sounds[sounds.length - 1];

    res.status(200).json({
      sounds: sounds.map((sound) =>
        publicSound(req, sound, authors.get(sound.userId.toString()), listened.has(sound._id.toString()))
      ),
      nextBefore: sounds.length === limit && last ? last.createdAt.toISOString() : null
    });
  } catch {
    res.status(500).json({ error: "Could not load sounds." });
  }
});

/** Stream a sound's audio. Public: playback uses a plain <audio>/fetch without credentials. */
router.get("/:id/audio", async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: "Sound not found." });
    return;
  }

  const sound = await SoundModel.findById(req.params.id, "audioUrl audioFileId audioMime").lean();

  if (!sound) {
    res.status(404).json({ error: "Sound not found." });
    return;
  }

  if (!sound.audioFileId) {
    // Seeded or externally hosted audio: send the client to where it actually lives.
    if (/^https?:\/\//i.test(sound.audioUrl)) {
      res.redirect(302, sound.audioUrl);
      return;
    }

    res.status(404).json({ error: "Audio not found." });
    return;
  }

  const length = await audioLength(sound.audioFileId);

  if (length === null) {
    res.status(404).json({ error: "Audio not found." });
    return;
  }

  res.set({
    // Only the allow-listed MIME type is ever served, and sniffing is disabled.
    "Content-Type": sound.audioMime ?? "audio/webm",
    "Content-Length": String(length),
    "X-Content-Type-Options": "nosniff",
    // The file behind an id never changes, so clients may cache it indefinitely.
    "Cache-Control": "public, max-age=31536000, immutable"
  });

  const stream = openAudio(sound.audioFileId);

  stream.on("error", () => {
    if (!res.headersSent) {
      res.status(500).json({ error: "Could not read audio." });
    } else {
      res.destroy();
    }
  });

  stream.pipe(res);
});

/** Add a photo of the place (multipart `photo`: JPEG, PNG or WebP). Only the sound's uploader may add photos. */
router.post("/:id/photos", requireAuth, async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: "Sound not found." });
    return;
  }

  const soundId = new mongoose.Types.ObjectId(req.params.id);
  const userId = new mongoose.Types.ObjectId(req.auth?.userId);
  const sound = await SoundModel.findById(soundId, "userId photos").lean();

  if (!sound) {
    res.status(404).json({ error: "Sound not found." });
    return;
  }

  if (!sound.userId.equals(userId)) {
    res.status(403).json({ error: "Only the uploader can add photos." });
    return;
  }

  if ((sound.photos?.length ?? 0) >= MAX_PHOTOS_PER_SOUND) {
    res.status(409).json({ error: `A Toone can have at most ${MAX_PHOTOS_PER_SOUND} photos.` });
    return;
  }

  if (!(await receiveFile(req, res, photoUpload.single("photo"), `Photos must be under ${MAX_PHOTO_BYTES / (1024 * 1024)} MB.`))) {
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "A photo file is required." });
    return;
  }

  const mime = sniffImageMime(req.file.buffer);

  if (!mime) {
    res.status(400).json({ error: "Photos must be JPEG, PNG or WebP." });
    return;
  }

  let fileId: mongoose.Types.ObjectId | undefined;

  try {
    fileId = await storePhoto(req.file.buffer, `${soundId.toString()}.${mime.split("/")[1]}`, mime);

    // The size check is repeated in the update so two parallel uploads cannot exceed the limit.
    const updated = await SoundModel.findOneAndUpdate(
      { _id: soundId, userId, [`photos.${MAX_PHOTOS_PER_SOUND - 1}`]: { $exists: false } },
      { $push: { photos: { fileId, mime } } },
      { new: true, projection: "photos" }
    ).lean();

    if (!updated) {
      await deletePhoto(fileId);
      res.status(409).json({ error: `A Toone can have at most ${MAX_PHOTOS_PER_SOUND} photos.` });
      return;
    }

    res.status(201).json({ photos: photoUrls(req, updated as unknown as Pick<SoundLean, "_id" | "photos">) });
  } catch {
    if (fileId) {
      await deletePhoto(fileId);
    }

    res.status(500).json({ error: "Could not save photo." });
  }
});

/** Stream one photo. Public, so a plain <img> works. */
router.get("/:id/photos/:photoId", async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.photoId)) {
    res.status(404).json({ error: "Photo not found." });
    return;
  }

  const sound = await SoundModel.findById(req.params.id, "photos").lean();
  const photo = sound?.photos?.find((entry) => entry.fileId.toString() === req.params.photoId);

  if (!photo) {
    res.status(404).json({ error: "Photo not found." });
    return;
  }

  const length = await photoLength(photo.fileId);

  if (length === null) {
    res.status(404).json({ error: "Photo not found." });
    return;
  }

  res.set({
    "Content-Type": photo.mime,
    "Content-Length": String(length),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=31536000, immutable"
  });

  const stream = openPhoto(photo.fileId);

  stream.on("error", () => {
    if (!res.headersSent) {
      res.status(500).json({ error: "Could not read photo." });
    } else {
      res.destroy();
    }
  });

  stream.pipe(res);
});

/** Record that the signed-in user listened. The first listen per user earns XP; replays only bump the count. */
router.post("/:id/listen", requireAuth, async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: "Sound not found." });
    return;
  }

  const soundId = new mongoose.Types.ObjectId(req.params.id);
  const userId = new mongoose.Types.ObjectId(req.auth?.userId);

  try {
    const sound = await SoundModel.findOneAndUpdate({ _id: soundId }, { $inc: { playCount: 1 } }, { new: true });

    if (!sound) {
      res.status(404).json({ error: "Sound not found." });
      return;
    }

    let firstListen = true;

    try {
      await ListenModel.create({ userId, soundId });
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }

      firstListen = false;
    }

    const user = firstListen
      ? await UserModel.findByIdAndUpdate(userId, { $inc: { xp: XP_PER_LISTEN } }, { new: true })
      : await UserModel.findById(userId);

    res.status(200).json({
      firstListen,
      playCount: sound.playCount,
      xp: user?.xp ?? 0,
      level: user?.level ?? 1
    });
  } catch {
    res.status(500).json({ error: "Could not record listen." });
  }
});

export default router;
