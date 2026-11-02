import dotenv from "dotenv";

dotenv.config();

const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const env = {
  port: Number(process.env.PORT ?? 4000),
  mongodbUri: process.env.MONGODB_URI ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  corsOrigins,
  /** Where the web app lives; password reset emails link to `${appUrl}/reset-password?token=...`. */
  appUrl: (process.env.APP_URL ?? corsOrigins[0] ?? "http://localhost:5173").replace(/\/+$/, ""),
  isProduction: process.env.NODE_ENV === "production",
  /** SMTP settings for outgoing email. Leave SMTP_HOST blank to log emails instead (development only). */
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.MAIL_FROM ?? "Toones <no-reply@toones.app>"
  }
};
