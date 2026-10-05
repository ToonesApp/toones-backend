import mongoose, { type HydratedDocument, type Model, type Types } from "mongoose";

const { Schema, model, models } = mongoose;

// One document per user per sound: a user's first listen earns XP, replays only bump Sound.playCount.
export interface Listen {
  userId: Types.ObjectId;
  soundId: Types.ObjectId;
  createdAt: Date;
}

export type ListenDocument = HydratedDocument<Listen>;

const listenSchema = new Schema<Listen>(
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

listenSchema.index({ userId: 1, soundId: 1 }, { unique: true });
listenSchema.index({ userId: 1, createdAt: -1 });
listenSchema.index({ soundId: 1 });

export const ListenModel =
  (models.Listen as Model<Listen> | undefined) ?? model<Listen>("Listen", listenSchema);
