import mongoose, { type HydratedDocument, type Model, type Types } from "mongoose";

const { Schema, model, models } = mongoose;

// One document per user per sound, so repeated likes can never count twice. Sound.likeCount mirrors the total.
export interface Like {
  userId: Types.ObjectId;
  soundId: Types.ObjectId;
  createdAt: Date;
}

export type LikeDocument = HydratedDocument<Like>;

const likeSchema = new Schema<Like>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    soundId: {
      type: Schema.Types.ObjectId,
      ref: "Sound",
      required: true
    }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

likeSchema.index({ userId: 1, soundId: 1 }, { unique: true });
likeSchema.index({ soundId: 1, createdAt: -1 });

export const LikeModel = (models.Like as Model<Like> | undefined) ?? model<Like>("Like", likeSchema);
