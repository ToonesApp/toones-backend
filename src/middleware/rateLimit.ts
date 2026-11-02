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

/** Counts every request: each one can trigger an email. Per-account throttling happens in the route too. */
export const forgotPasswordLimiter = limiter(60 * MINUTE, 5, "Too many reset requests. Try again in an hour.");

/** Guessing a reset token is infeasible, but cap attempts anyway. */
export const resetPasswordLimiter = limiter(15 * MINUTE, 10, "Too many attempts. Try again in 15 minutes.");

export const verifyEmailLimiter = limiter(15 * MINUTE, 20, "Too many attempts. Try again in 15 minutes.");

export const resendVerificationLimiter = limiter(60 * MINUTE, 5, "Too many verification emails requested. Try again in an hour.");
