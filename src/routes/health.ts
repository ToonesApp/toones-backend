import { Router } from "express";

import { env } from "../config/env.js";

const router = Router();

router.get("/", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "toones-api",
    // Booleans only — never leak host, user, or secrets. Used to confirm prod env after deploy.
    auth: {
      google: Boolean(env.googleClientId),
      smtp: Boolean(env.smtp.host),
      appUrl: env.appUrl
    }
  });
});

export default router;
