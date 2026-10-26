import cors from "cors";
import express from "express";

import { env } from "./config/env.js";
import { connectMongo } from "./db/connect.js";
import authRouter from "./routes/auth.js";
import friendsRouter from "./routes/friends.js";
import healthRouter from "./routes/health.js";
import soundsRouter from "./routes/sounds.js";
import usersRouter from "./routes/users.js";

const app = express();

// Render terminates TLS in front of the app; trust it so req.protocol is "https" when building audio URLs.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: env.corsOrigins,
    credentials: true
  })
);
app.use(express.json());

app.use("/auth", authRouter);
app.use("/friends", friendsRouter);
app.use("/health", healthRouter);
app.use("/sounds", soundsRouter);
app.use("/users", usersRouter);

app.listen(env.port, () => {
  console.log(`Toones API listening on port ${env.port}.`);
});

void connectMongo(env.mongodbUri);
