import { rateLimit } from "express-rate-limit";

const MINUTE = 60 * 1000;

// Counts are kept in memory per IP, so they reset when the server restarts.
// req.ip is the real client IP because index.ts sets "trust proxy" for Render.
function limiter(windowMs: number, limit: number, error: string, skipSuccessfulRequests = false) {
  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error }
  });
}

/** Only failed attempts count, so a user who signs in successfully is never locked out. */
export const loginLimiter = limiter(15 * MINUTE, 10, "Too many login attempts. Try again in 15 minutes.", true);

export const registerLimiter = limiter(60 * MINUTE, 5, "Too many sign-ups from this network. Try again in an hour.");

export const googleLimiter = limiter(15 * MINUTE, 20, "Too many Google sign-in attempts. Try again in 15 minutes.");
