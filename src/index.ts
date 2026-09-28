import cors from "cors";
import express from "express";

import { env } from "./config/env.js";
import { connectMongo } from "./db/connect.js";
import authRouter from "./routes/auth.js";
import healthRouter from "./routes/health.js";

const app = express();

app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true
  })
);
app.use(express.json());

app.use("/auth", authRouter);
app.use("/health", healthRouter);

app.listen(env.port, () => {
  console.log(`Toones API listening on port ${env.port}.`);
});

void connectMongo(env.mongodbUri);
