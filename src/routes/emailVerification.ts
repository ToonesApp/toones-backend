import { Router } from "express";

import { isMongoConnected } from "../db/connect.js";
import { hashToken, issueVerificationEmail } from "../lib/emailVerification.js";
import { resendVerificationLimiter, verifyEmailLimiter } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { EmailVerificationModel } from "../models/EmailVerification.js";
import { UserModel } from "../models/User.js";

const router = Router();
const MAX_TOKEN_LENGTH = 200;
const INVALID = "This verification link is invalid or has expired.";

/** Confirms an address from the emailed link. No sign-in needed, so it works from any device. */
router.post("/verify-email", verifyEmailLimiter, async (req, res) => {
  if (!isMongoConnected()) {
    res.status(503).json({ error: "Database is not connected." });
    return;
  }

  const raw = (req.body as { token?: unknown } | undefined)?.token;
  const token = typeof raw === "string" ? raw.trim() : "";

  if (!token || token.length > MAX_TOKEN_LENGTH) {
    res.status(400).json({ error: INVALID });
    return;
  }

  try {
    // Deleting is the check: a link can only ever be used once.
    const record = await EmailVerificationModel.findOneAndDelete({
      tokenHash: hashToken(token),
      expiresAt: { $gt: new Date() }
    });

    if (!record) {
      res.status(400).json({ error: INVALID });
      return;
    }

    // Only verify if the account still has the address the link was sent to.
    const user = await UserModel.findOneAndUpdate(
      { _id: record.userId, email: record.email },
      { $set: { emailVerified: true } },
      { new: true }
    );

    if (!user) {
      res.status(400).json({ error: INVALID });
      return;
    }

    res.status(200).json({ message: "Your email is verified.", emailVerified: true });
  } catch {
    res.status(500).json({ error: "Could not verify your email." });
  }
});

/** Sends a fresh link to the signed-in user, unless they're already verified. */
router.post("/resend-verification", requireAuth, resendVerificationLimiter, async (req, res) => {
  if (!isMongoConnected()) {
    res.status(503).json({ error: "Database is not connected." });
    return;
  }

  try {
    const user = await UserModel.findById(req.auth?.userId);

    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    if (user.emailVerified) {
      res.status(200).json({ message: "Your email is already verified.", emailVerified: true });
      return;
    }

    const sent = await issueVerificationEmail(user);

    if (!sent) {
      res.status(429).json({ error: "We just sent one. Give it a minute, then try again." });
      return;
    }

    res.status(200).json({ message: "Verification email sent.", emailVerified: false });
  } catch {
    res.status(500).json({ error: "Could not send the verification email." });
  }
});

export default router;
