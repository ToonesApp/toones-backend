import bcrypt from "bcrypt";
import { Router, type Response } from "express";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";

import { env } from "../config/env.js";
import { isMongoConnected } from "../db/connect.js";
import { issueVerificationEmail } from "../lib/emailVerification.js";
import { MAX_BIO_LENGTH, parseBio } from "../lib/bio.js";
import { firstLockedPart, parseLook, plainLook } from "../lib/look.js";
import { removeSounds } from "../lib/removeSounds.js";
import { deleteAccountLimiter, googleLimiter, loginLimiter, registerLimiter } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { EmailVerificationModel } from "../models/EmailVerification.js";
import { FollowModel } from "../models/Follow.js";
import { PasswordResetModel } from "../models/PasswordReset.js";
import { ListenModel } from "../models/Listen.js";
import { SoundModel } from "../models/Sound.js";
import { UserModel, type UserDocument } from "../models/User.js";

const router = Router();
const passwordSaltRounds = 12;
const tokenExpiresIn = "7d";
const MIN_PASSWORD_LENGTH = 8;
/** bcrypt ignores everything past 72 bytes, so longer passwords would silently match shorter ones. */
const MAX_PASSWORD_BYTES = 72;
/** The longest email address the email standard allows; also caps the login field. */
const MAX_EMAIL_LENGTH = 254;

type RegisterBody = {
  email?: unknown;
  username?: unknown;
  displayName?: unknown;
  password?: unknown;
};

type LoginBody = {
  emailOrUsername?: unknown;
  password?: unknown;
};

type GoogleBody = {
  credential?: unknown;
};

const googleClient = new OAuth2Client();

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeEmail(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizeUsername(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

/** Turns an email's local part into a valid username base: [a-z0-9_], 3-18 chars. */
function usernameBaseFromEmail(email: string): string {
  const base = (email.split("@")[0] ?? "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 18);

  return (base || "user").padEnd(3, "0");
}

/** Picks a free username from the email, adding a numeric suffix on collisions. */
async function generateUsername(email: string): Promise<string> {
  const base = usernameBaseFromEmail(email);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}${Math.floor(1000 + Math.random() * 9000)}`;

    if (!(await UserModel.exists({ username: candidate }))) {
      return candidate;
    }
  }

  return `${base.slice(0, 14)}${Date.now().toString(36).slice(-8)}`.slice(0, 24);
}

function publicUser(user: UserDocument) {
  return {
    id: user._id.toString(),
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    xp: user.xp,
    level: user.level,
    emailVerified: user.emailVerified === true,
    look: user.look ? plainLook(user.look) : null,
    bio: user.bio ?? "",
    createdAt: user.createdAt.toISOString()
  };
}

function signToken(user: UserDocument): string {
  if (!env.jwtSecret) {
    throw new Error("JWT_SECRET is not configured.");
  }

  return jwt.sign({}, env.jwtSecret, {
    subject: user._id.toString(),
    expiresIn: tokenExpiresIn
  });
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}

function ensureMongo(res: Response): boolean {
  if (isMongoConnected()) {
    return true;
  }

  res.status(503).json({ error: "Database is not connected." });
  return false;
}

router.post("/register", registerLimiter, async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  const { email, username, displayName, password } = req.body as RegisterBody;
  const normalizedEmail = normalizeEmail(email);
  let normalizedUsername = normalizeUsername(username);
  const usernameWasGenerated = normalizedUsername === "";
  const cleanedDisplayName = normalizeText(displayName);
  const rawPassword = stringValue(password);

  if (normalizedEmail.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    res.status(400).json({ error: "A valid email is required." });
    return;
  }

  if (!usernameWasGenerated && !/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) {
    res.status(400).json({ error: "Username must be 3-24 characters using letters, numbers, or underscores." });
    return;
  }

  if (cleanedDisplayName.length < 1 || cleanedDisplayName.length > 60) {
    res.status(400).json({ error: "Display name must be 1-60 characters." });
    return;
  }

  if (rawPassword.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    return;
  }

  if (Buffer.byteLength(rawPassword, "utf8") > MAX_PASSWORD_BYTES) {
    res.status(400).json({ error: `Password must be at most ${MAX_PASSWORD_BYTES} characters.` });
    return;
  }

  try {
    const existingUser = await UserModel.findOne(
      usernameWasGenerated
        ? { email: normalizedEmail }
        : { $or: [{ email: normalizedEmail }, { username: normalizedUsername }] }
    );

    if (existingUser) {
      res.status(409).json({ error: "Email or username is already in use." });
      return;
    }

    if (usernameWasGenerated) {
      normalizedUsername = await generateUsername(normalizedEmail);
    }

    const passwordHash = await bcrypt.hash(rawPassword, passwordSaltRounds);
    const user = await UserModel.create({
      email: normalizedEmail,
      username: normalizedUsername,
      displayName: cleanedDisplayName,
      passwordHash
    });

    res.status(201).json({ token: signToken(user), user: publicUser(user) });

    // After replying: a mail outage must never block sign-up. The user can resend from the app.
    issueVerificationEmail(user).catch((error: unknown) => {
      console.error("Could not send verification email:", error instanceof Error ? error.message : error);
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      res.status(409).json({ error: "Email or username is already in use." });
      return;
    }

    res.status(500).json({ error: "Could not register user." });
  }
});

router.post("/login", loginLimiter, async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  const { emailOrUsername, password } = req.body as LoginBody;
  const login = normalizeText(emailOrUsername).toLowerCase();
  const rawPassword = stringValue(password);

  if (!login || !rawPassword) {
    res.status(400).json({ error: "Email/username and password are required." });
    return;
  }

  if (login.length > MAX_EMAIL_LENGTH) {
    res.status(400).json({ error: "Email/username is too long." });
    return;
  }

  try {
    const user = await UserModel.findOne({
      $or: [{ email: login }, { username: login }]
    }).select("+passwordHash");

    // Google-only accounts have no password, so password login can never succeed for them.
    if (!user || !user.passwordHash) {
      res.status(401).json({ error: "Invalid credentials." });
      return;
    }

    const isPasswordValid = await bcrypt.compare(rawPassword, user.passwordHash);

    if (!isPasswordValid) {
      res.status(401).json({ error: "Invalid credentials." });
      return;
    }

    res.status(200).json({ token: signToken(user), user: publicUser(user) });
  } catch {
    res.status(500).json({ error: "Could not sign in." });
  }
});

/**
 * Sign in or sign up with a Google ID token (the `credential` from Google Identity Services).
 * The token is verified against our client id; an account is matched by Google id, then by
 * verified email, and created if neither exists.
 */
router.post("/google", googleLimiter, async (req, res) => {
  if (!env.googleClientId) {
    res.status(503).json({ error: "Google sign-in is not configured." });
    return;
  }

  if (!ensureMongo(res)) {
    return;
  }

  const credential = stringValue((req.body as GoogleBody).credential);

  if (!credential) {
    res.status(400).json({ error: "A Google credential is required." });
    return;
  }

  let payload;

  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: env.googleClientId });
    payload = ticket.getPayload();
  } catch {
    res.status(401).json({ error: "Invalid Google credential." });
    return;
  }

  if (!payload?.sub || !payload.email || !payload.email_verified) {
    res.status(401).json({ error: "Your Google account needs a verified email." });
    return;
  }

  const email = normalizeEmail(payload.email);

  try {
    let user = await UserModel.findOne({ googleId: payload.sub });

    if (!user) {
      user = await UserModel.findOne({ email });

      if (user) {
        user.googleId = payload.sub;
        // Google only hands us verified emails, so this account's address is now proven.
        user.emailVerified = true;
        await user.save();
      } else {
        const displayName = normalizeText(payload.name ?? email.split("@")[0]).slice(0, 60) || "Toones user";

        user = await UserModel.create({
          email,
          username: await generateUsername(email),
          displayName,
          googleId: payload.sub,
          emailVerified: true
        });
      }
    }

    res.status(200).json({ token: signToken(user), user: publicUser(user) });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      res.status(409).json({ error: "Email or username is already in use." });
      return;
    }

    res.status(500).json({ error: "Could not sign in with Google." });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  const user = await UserModel.findById(req.auth?.userId);

  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  res.status(200).json({ user: publicUser(user) });
});

/** Saves the signed-in user's bio. An empty string clears it. */
router.put("/me/bio", requireAuth, async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  const bio = parseBio((req.body as { bio?: unknown } | undefined)?.bio);

  if (bio === null) {
    res.status(400).json({ error: `Your bio must be ${MAX_BIO_LENGTH} characters or fewer.` });
    return;
  }

  try {
    const user = await UserModel.findById(req.auth?.userId);

    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    user.bio = bio;
    await user.save();

    res.status(200).json({ user: publicUser(user) });
  } catch {
    res.status(500).json({ error: "Could not save your bio." });
  }
});

/** Saves the signed-in user's character. Rejects unknown parts and anything the user hasn't unlocked yet. */
router.put("/me/look", requireAuth, async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  const look = parseLook((req.body as { look?: unknown } | undefined)?.look);

  if (!look) {
    res.status(400).json({ error: "That character isn't valid." });
    return;
  }

  try {
    const user = await UserModel.findById(req.auth?.userId);

    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const [drops, places, listens] = await Promise.all([
      SoundModel.countDocuments({ userId: user._id }),
      SoundModel.distinct("placeName", { userId: user._id, placeName: { $nin: [null, ""] } }),
      ListenModel.countDocuments({ userId: user._id })
    ]);

    if (firstLockedPart(look, { xp: user.xp, drops, places: places.length, listens })) {
      res.status(403).json({ error: "That character uses items you haven't unlocked yet." });
      return;
    }

    user.look = look;
    await user.save();

    res.status(200).json({ user: publicUser(user) });
  } catch {
    res.status(500).json({ error: "Could not save your character." });
  }
});

/**
 * Permanently deletes the signed-in user with their drops (and those drops' files and listens),
 * their listens on other drops, and their friend links. Password accounts must confirm with
 * their current password; Google-only accounts have none, so the session is enough.
 * Listeners keep the XP they earned from the deleted drops.
 */
router.delete("/me", deleteAccountLimiter, requireAuth, async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  const rawPassword = stringValue((req.body as { password?: unknown } | undefined)?.password);

  try {
    const user = await UserModel.findById(req.auth?.userId).select("+passwordHash");

    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    if (user.passwordHash) {
      if (!rawPassword) {
        res.status(400).json({ error: "Enter your password to delete your account." });
        return;
      }

      if (!(await bcrypt.compare(rawPassword, user.passwordHash))) {
        res.status(403).json({ error: "That password is incorrect." });
        return;
      }
    }

    const sounds = await SoundModel.find({ userId: user._id }, "audioFileId photos").lean();
    await removeSounds(sounds);
    await ListenModel.deleteMany({ userId: user._id });
    await FollowModel.deleteMany({ $or: [{ followerId: user._id }, { followingId: user._id }] });
    // Outstanding reset / verification links die with the account.
    await PasswordResetModel.deleteMany({ userId: user._id });
    await EmailVerificationModel.deleteMany({ userId: user._id });
    await UserModel.deleteOne({ _id: user._id });

    res.status(200).json({ deleted: true });
  } catch {
    res.status(500).json({ error: "Could not delete your account." });
  }
});

export default router;
