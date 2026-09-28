import mongoose from "mongoose";

export function isMongoConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function connectMongo(uri: string): Promise<void> {
  if (!uri) {
    console.warn("MONGODB_URI is not set; starting API without MongoDB.");
    return;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
    console.log("MongoDB connected.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown MongoDB error";
    console.warn(`MongoDB connection failed; continuing without DB. ${message}`);
  }
}
