import { createHash, randomBytes } from "node:crypto";

import bcrypt from "bcrypt";
import { Router } from "express";

import { env } from "../config/env.js";
import { isMongoConnected } from "../db/connect.js";
import { passwordChangedEmail, passwordResetEmail, sendEmail } from "../lib/mailer.js";
import { passwordProblem } from "../lib/password.js";
import { forgotPasswordLimiter, resetPasswordLimiter } from "../middleware/rateLimit.js";
import { PasswordResetModel } from "../models/PasswordReset.js";
import { UserModel } from "../models/User.js";

const router = Router();

const RESET_TTL_MINUTES = 60;
/** A second email for the same account within this window is skipped, so nobody can flood a victim's inbox. */
const RESEND_COOLDOWN_MS = 60 * 1000;
const PASSWORD_SALT_ROUNDS = 12;
const MAX_EMAIL_LENGTH = 254;
const MAX_TOKEN_LENGTH = 200;

/** Same answer whether or not the address has an account, so this endpoint can't be used to find out who signed up. */
const FORGOT_RESPONSE = { message: "If an account exists for that email, a reset link is on its way." };

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates a single-use token for the account and emails the link. Runs after the response is sent. */
async function issueResetEmail(email: string): Promise<void> {
  const user = await UserModel.findOne({ email });

  if (!user) {
    return;
  }

  const recent = await PasswordResetModel.findOne({
    userId: user._id,
    createdAt: { $gt: new Date(Date.now() - RESEND_COOLDOWN_MS) }
  });

  if (recent) {
    return;
  }

  // Only the newest link works.
  await PasswordResetModel.deleteMany({ userId: user._id });

  const token = randomBytes(32).toString("base64url");
  await PasswordResetModel.create({
    userId: user._id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000)
  });

  const link = `${env.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  await sendEmail(passwordResetEmail(user.email, user.displayName, link, RESET_TTL_MINUTES));
}

router.post("/forgot-password", forgotPasswordLimiter, (req, res) => {
  if (!isMongoConnected()) {
    res.status(503).json({ error: "Database is not connected." });
    return;
  }

  const raw = (req.body as { email?: unknown } | undefined)?.email;
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (email.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "A valid email is required." });
    return;
  }

  res.status(200).json(FORGOT_RESPONSE);

  // Done after replying so response time doesn't reveal whether the account exists.
  issueResetEmail(email).catch((error: unknown) => {
    console.error("Could not send password reset email:", error instanceof Error ? error.message : error);
  });
});

router.post("/reset-password", resetPasswordLimiter, async (req, res) => {
  if (!isMongoConnected()) {
    res.status(503).json({ error: "Database is not connected." });
    return;
  }

  const body = (req.body ?? {}) as { token?: unknown; password?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!token || token.length > MAX_TOKEN_LENGTH) {
    res.status(400).json({ error: "This reset link is invalid or has expired." });
    return;
  }

  const problem = passwordProblem(password);

  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  try {
    // Deleting is the check: only one request can ever consume a given token.
    const reset = await PasswordResetModel.findOneAndDelete({
      tokenHash: hashToken(token),
      expiresAt: { $gt: new Date() }
    });

    if (!reset) {
      res.status(400).json({ error: "This reset link is invalid or has expired." });
      return;
    }

    const user = await UserModel.findById(reset.userId).select("+passwordHash");

    if (!user) {
      res.status(400).json({ error: "This reset link is invalid or has expired." });
      return;
    }

    user.passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
    await user.save();
    // Any other outstanding links for this account are now void.
    await PasswordResetModel.deleteMany({ userId: user._id });

    res.status(200).json({ message: "Your password has been updated. You can sign in now." });

    sendEmail(passwordChangedEmail(user.email, user.displayName)).catch(() => {});
  } catch {
    res.status(500).json({ error: "Could not reset your password." });
  }
});

export default router;
