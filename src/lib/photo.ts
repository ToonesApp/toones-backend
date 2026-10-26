import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import mongoose from "mongoose";

export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const MAX_PHOTOS_PER_SOUND = 3;

/**
 * Detects the image type from the file's first bytes. The client-sent MIME type is not trusted,
 * so only real JPEG, PNG and WebP files are stored and an upload can never be served as HTML or SVG.
 */
export function sniffImageMime(data: Buffer): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }

  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }

  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }

  return null;
}

function bucket() {
  const db = mongoose.connection.db;

  if (!db) {
    throw new Error("MongoDB is not connected.");
  }

  return new mongoose.mongo.GridFSBucket(db, { bucketName: "photos" });
}

export async function storePhoto(
  data: Buffer,
  filename: string,
  contentType: string
): Promise<mongoose.Types.ObjectId> {
  const upload = bucket().openUploadStream(filename, { contentType });
  await pipeline(Readable.from(data), upload);
  return upload.id as mongoose.Types.ObjectId;
}

export async function deletePhoto(id: mongoose.Types.ObjectId): Promise<void> {
  await bucket().delete(id).catch(() => undefined);
}

/** File length in bytes, or null when the GridFS file does not exist. */
export async function photoLength(id: mongoose.Types.ObjectId): Promise<number | null> {
  const [file] = await bucket().find({ _id: id }).limit(1).toArray();
  return file ? file.length : null;
}

export function openPhoto(id: mongoose.Types.ObjectId) {
  return bucket().openDownloadStream(id);
}
