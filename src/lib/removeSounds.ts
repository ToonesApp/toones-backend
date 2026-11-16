import type mongoose from "mongoose";

import { LikeModel } from "../models/Like.js";
import { ListenModel } from "../models/Listen.js";
import { SoundModel } from "../models/Sound.js";
import { deleteAudio } from "./audio.js";
import { deletePhoto } from "./photo.js";

export type RemovableSound = {
  _id: mongoose.Types.ObjectId;
  audioFileId?: mongoose.Types.ObjectId;
  photos?: { fileId: mongoose.Types.ObjectId }[];
};

/**
 * Deletes sounds together with everything attached to them: their listens and likes, and their audio and photo files in GridFS.
 * The documents go first so a sound never points at a missing file; file deletes are best-effort.
 */
export async function removeSounds(sounds: RemovableSound[]): Promise<void> {
  if (sounds.length === 0) {
    return;
  }

  const ids = sounds.map((sound) => sound._id);

  await ListenModel.deleteMany({ soundId: { $in: ids } });
  await LikeModel.deleteMany({ soundId: { $in: ids } });
  await SoundModel.deleteMany({ _id: { $in: ids } });

  await Promise.all(
    sounds.flatMap((sound) => [
      ...(sound.audioFileId ? [deleteAudio(sound.audioFileId)] : []),
      ...(sound.photos ?? []).map((photo) => deletePhoto(photo.fileId))
    ])
  );
}
