import mongoose, { type HydratedDocument, type Model } from "mongoose";

import { levelFromXp } from "../lib/xp.js";

const { Schema, model, models } = mongoose;

export interface User {
  email: string;
  username: string;
  displayName: string;
  /** Absent for accounts created through Google sign-in. */
  passwordHash?: string;
  /** Google's stable subject id; present once the account is linked to Google. */
  googleId?: string;
  xp: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserVirtuals {
  level: number;
}

export type UserDocument = HydratedDocument<User, UserVirtuals>;

const userSchema = new Schema<User, Model<User, object, object, UserVirtuals>, object, object, UserVirtuals>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true
    },
    username: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true
    },
    displayName: {
      type: String,
      required: true,
      trim: true
    },
    passwordHash: {
      type: String,
      required: function (this: { googleId?: string }) {
        return !this.googleId;
      },
      select: false
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true
    },
    xp: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  { timestamps: true }
);

userSchema.virtual("level").get(function () {
  return levelFromXp(this.xp ?? 0);
});

type UserModelType = Model<User, object, object, UserVirtuals>;

export const UserModel =
  (models.User as UserModelType | undefined) ??
  model<User, UserModelType>("User", userSchema);
