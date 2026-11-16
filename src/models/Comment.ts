import mongoose, { type HydratedDocument, type Model, type Types } from "mongoose";

const { Schema, model, models } = mongoose;

export const MAX_COMMENT_LENGTH = 280;

// Sound.commentCount mirrors the number of comments on each sound.
export interface Comment {
  soundId: Types.ObjectId;
  userId: Types.ObjectId;
  text: string;
  createdAt: Date;
}

export type CommentDocument = HydratedDocument<Comment>;

const commentSchema = new Schema<Comment>(
  {
    soundId: {
      type: Schema.Types.ObjectId,
      ref: "Sound",
      required: true
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_COMMENT_LENGTH
    }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

commentSchema.index({ soundId: 1, createdAt: -1 });

export const CommentModel = (models.Comment as Model<Comment> | undefined) ?? model<Comment>("Comment", commentSchema);
