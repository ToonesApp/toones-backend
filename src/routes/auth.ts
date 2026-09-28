import bcrypt from "bcrypt";
import { Router, type Response } from "express";
import jwt from "jsonwebtoken";

import { env } from "../config/env.js";
import { isMongoConnected } from "../db/connect.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { UserModel, type UserDocument } from "../models/User.js";

const router = Router();
const passwordSaltRounds = 12;
const tokenExpiresIn = "7d";

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

function publicUser(user: UserDocument) {
  return {
    id: user._id.toString(),
    email: user.email,
    username: user.username,
    displayName: user.displayName,
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

router.post("/register", async (req, res) => {
  if (!ensureMongo(res)) {
    return;
  }

  const { email, username, displayName, password } = req.body as RegisterBody;
  const normalizedEmail = normalizeEmail(email);
  const normalizedUsername = normalizeUsername(username);
  const cleanedDisplayName = normalizeText(displayName);
  const rawPassword = stringValue(password);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    res.status(400).json({ error: "A valid email is required." });
    return;
  }

  if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) {
    res.status(400).json({ error: "Username must be 3-24 characters using letters, numbers, or underscores." });
    return;
  }

  if (cleanedDisplayName.length < 1 || cleanedDisplayName.length > 60) {
    res.status(400).json({ error: "Display name must be 1-60 characters." });
    return;
  }

  if (rawPassword.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }

  try {
    const existingUser = await UserModel.findOne({
      $or: [{ email: normalizedEmail }, { username: normalizedUsername }]
    });

    if (existingUser) {
      res.status(409).json({ error: "Email or username is already in use." });
      return;
    }

    const passwordHash = await bcrypt.hash(rawPassword, passwordSaltRounds);
    const user = await UserModel.create({
      email: normalizedEmail,
      username: normalizedUsername,
      displayName: cleanedDisplayName,
      passwordHash
    });

    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      res.status(409).json({ error: "Email or username is already in use." });
      return;
    }

    res.status(500).json({ error: "Could not register user." });
  }
});

router.post("/login", async (req, res) => {
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

  const user = await UserModel.findOne({
    $or: [{ email: login }, { username: login }]
  }).select("+passwordHash");

  if (!user) {
    res.status(401).json({ error: "Invalid credentials." });
    return;
  }

  const isPasswordValid = await bcrypt.compare(rawPassword, user.passwordHash);

  if (!isPasswordValid) {
    res.status(401).json({ error: "Invalid credentials." });
    return;
  }

  res.status(200).json({ token: signToken(user), user: publicUser(user) });
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

export default router;
