import mongoose, { type Model, type Types } from "mongoose";

const { Schema, model, models } = mongoose;

export interface PasswordReset {
  userId: Types.ObjectId;
  /** SHA-256 of the emailed token. The raw token is never stored, so a database leak can't be used to reset accounts. */
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

const passwordResetSchema = new Schema<PasswordReset>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    // MongoDB removes the document once this time passes.
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

type PasswordResetModelType = Model<PasswordReset>;

export const PasswordResetModel =
  (models.PasswordReset as PasswordResetModelType | undefined) ??
  model<PasswordReset, PasswordResetModelType>("PasswordReset", passwordResetSchema);
