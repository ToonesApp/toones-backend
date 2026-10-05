import mongoose, { type HydratedDocument, type Model, type Types } from "mongoose";

const { Schema, model, models } = mongoose;

export interface Follow {
  followerId: Types.ObjectId;
  followingId: Types.ObjectId;
  createdAt: Date;
}

export type FollowDocument = HydratedDocument<Follow>;

const followSchema = new Schema<Follow>(
  {
    followerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    followingId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      validate: {
        validator: function (this: Follow, value: Types.ObjectId) {
          return !value.equals(this.followerId);
        },
        message: "Users cannot follow themselves."
      }
    }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

followSchema.index({ followerId: 1, followingId: 1 }, { unique: true });
followSchema.index({ followingId: 1, createdAt: -1 });

export const FollowModel =
  (models.Follow as Model<Follow> | undefined) ?? model<Follow>("Follow", followSchema);
