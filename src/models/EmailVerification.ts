import mongoose, { type Model, type Types } from "mongoose";

const { Schema, model, models } = mongoose;

export interface EmailVerification {
  userId: Types.ObjectId;
  /** SHA-256 of the emailed token; the raw token is never stored. */
  tokenHash: string;
  /** The address the link was sent to, so a link can't verify an email the user has since changed. */
  email: string;
  expiresAt: Date;
  createdAt: Date;
}

const emailVerificationSchema = new Schema<EmailVerification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

type EmailVerificationModelType = Model<EmailVerification>;

export const EmailVerificationModel =
  (models.EmailVerification as EmailVerificationModelType | undefined) ??
  model<EmailVerification, EmailVerificationModelType>("EmailVerification", emailVerificationSchema);
