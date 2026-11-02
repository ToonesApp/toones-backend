import { createHash, randomBytes } from "node:crypto";

import { env } from "../config/env.js";
import { EmailVerificationModel } from "../models/EmailVerification.js";
import { sendEmail, verificationEmail } from "./mailer.js";

export const VERIFY_TTL_HOURS = 24;
/** A second verification email within this window is skipped, so a signed-in user can't be used to flood an inbox. */
const RESEND_COOLDOWN_MS = 60 * 1000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

type Recipient = { _id: unknown; email: string; displayName: string };

/**
 * Emails a one-time "confirm your address" link. Resolves to false when skipped by the cooldown.
 * Callers run this in the background and log failures; a mail outage must never block sign-up.
 */
export async function issueVerificationEmail(user: Recipient): Promise<boolean> {
  const recent = await EmailVerificationModel.findOne({
    userId: user._id,
    createdAt: { $gt: new Date(Date.now() - RESEND_COOLDOWN_MS) }
  });

  if (recent) {
    return false;
  }

  await EmailVerificationModel.deleteMany({ userId: user._id });

  const token = randomBytes(32).toString("base64url");
  await EmailVerificationModel.create({
    userId: user._id,
    email: user.email,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + VERIFY_TTL_HOURS * 60 * 60 * 1000)
  });

  const link = `${env.appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  await sendEmail(verificationEmail(user.email, user.displayName, link, VERIFY_TTL_HOURS));
  return true;
}
