import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import mongoose from "mongoose";

/** Largest upload accepted. A 60 s Opus clip is well under 1 MB; this leaves room for AAC/WAV. */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

/** Only these base types are stored and ever served back, so an upload can never be served as HTML. */
const allowedBaseTypes = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/mp3",
  "audio/aac",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav"
]);

/** Returns the normalized base MIME type (parameters like `;codecs=opus` removed), or null if not allowed. */
export function normalizeAudioMime(mimeType: string): string | null {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return allowedBaseTypes.has(base) ? base : null;
}

function bucket() {
  const db = mongoose.connection.db;

  if (!db) {
    throw new Error("MongoDB is not connected.");
  }

  return new mongoose.mongo.GridFSBucket(db, { bucketName: "audio" });
}

export async function storeAudio(
  data: Buffer,
  filename: string,
  contentType: string
): Promise<mongoose.Types.ObjectId> {
  const upload = bucket().openUploadStream(filename, { contentType });
  await pipeline(Readable.from(data), upload);
  return upload.id as mongoose.Types.ObjectId;
}

export async function deleteAudio(id: mongoose.Types.ObjectId): Promise<void> {
  await bucket().delete(id).catch(() => undefined);
}

/** File length in bytes, or null when the GridFS file does not exist. */
export async function audioLength(id: mongoose.Types.ObjectId): Promise<number | null> {
  const [file] = await bucket().find({ _id: id }).limit(1).toArray();
  return file ? file.length : null;
}

export function openAudio(id: mongoose.Types.ObjectId) {
  return bucket().openDownloadStream(id);
}
