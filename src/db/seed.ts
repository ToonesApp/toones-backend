import bcrypt from "bcrypt";
import mongoose from "mongoose";

import { env } from "../config/env.js";
import { SoundModel, type Sound } from "../models/Sound.js";
import { UserModel } from "../models/User.js";

const seedEmailDomain = "seed.toones.dev";
const seedPassword = "password123";

const seedUsers = [
  { username: "maya", displayName: "Maya Chen" },
  { username: "leo", displayName: "Leo Okafor" },
  { username: "sana", displayName: "Sana Iqbal" }
];

type SeedSound = Omit<Sound, "userId" | "playCount" | "createdAt" | "updatedAt"> & {
  username: string;
};

const seedSounds: SeedSound[] = [
  {
    username: "maya",
    title: "Morning birds in the park",
    audioUrl: "https://example.com/audio/central-park-birds.mp3",
    durationSec: 24,
    category: "nature",
    tags: ["birds", "morning"],
    location: { type: "Point", coordinates: [-73.9654, 40.7829] },
    placeName: "Central Park, New York"
  },
  {
    username: "leo",
    title: "Subway platform rush",
    audioUrl: "https://example.com/audio/times-sq-subway.mp3",
    durationSec: 18,
    category: "city",
    tags: ["transit", "crowd"],
    location: { type: "Point", coordinates: [-73.9871, 40.7553] },
    placeName: "Times Square Station, New York"
  },
  {
    username: "sana",
    title: "Spice market calls",
    audioUrl: "https://example.com/audio/spice-bazaar.mp3",
    durationSec: 30,
    category: "culture",
    tags: ["market", "voices"],
    location: { type: "Point", coordinates: [28.9706, 41.0166] },
    placeName: "Spice Bazaar, Istanbul"
  },
  {
    username: "leo",
    title: "Street drummers",
    audioUrl: "https://example.com/audio/street-drums.mp3",
    durationSec: 45,
    category: "music",
    tags: ["drums", "street"],
    location: { type: "Point", coordinates: [-43.1729, -22.9068] },
    placeName: "Lapa, Rio de Janeiro"
  },
  {
    username: "maya",
    title: "Good morning in Cantonese",
    audioUrl: "https://example.com/audio/cantonese-greeting.mp3",
    durationSec: 8,
    category: "language",
    tags: ["greeting", "cantonese"],
    location: { type: "Point", coordinates: [114.1694, 22.3193] },
    placeName: "Mong Kok, Hong Kong"
  },
  {
    username: "sana",
    title: "Waves on the rocks",
    audioUrl: "https://example.com/audio/waves.mp3",
    durationSec: 40,
    category: "nature",
    tags: ["water", "ocean"],
    location: { type: "Point", coordinates: [-122.4783, 37.8199] },
    placeName: "Golden Gate, San Francisco"
  }
];

async function seed(): Promise<void> {
  if (!env.mongodbUri) {
    throw new Error("MONGODB_URI is not set. Add it to your .env file.");
  }

  await mongoose.connect(env.mongodbUri, { serverSelectionTimeoutMS: 5000 });
  console.log("MongoDB connected.");

  await Promise.all([UserModel.syncIndexes(), SoundModel.syncIndexes()]);

  const seedEmailPattern = new RegExp(`@${seedEmailDomain.replace(/\./g, "\\.")}$`);
  const oldUsers = await UserModel.find({ email: seedEmailPattern }).select("_id");
  const oldUserIds = oldUsers.map((user) => user._id);
  await SoundModel.deleteMany({ userId: { $in: oldUserIds } });
  await UserModel.deleteMany({ _id: { $in: oldUserIds } });

  const passwordHash = await bcrypt.hash(seedPassword, 12);
  const users = await UserModel.insertMany(
    seedUsers.map((user) => ({
      ...user,
      email: `${user.username}@${seedEmailDomain}`,
      passwordHash
    }))
  );

  const userIdsByUsername = new Map(users.map((user) => [user.username, user._id]));
  const sounds = await SoundModel.insertMany(
    seedSounds.map(({ username, ...sound }) => ({
      ...sound,
      userId: userIdsByUsername.get(username)
    }))
  );

  console.log(`Seeded ${users.length} users and ${sounds.length} sounds.`);
  console.log(`Log in with any seed user, e.g. maya@${seedEmailDomain} / ${seedPassword}`);
}

seed()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
