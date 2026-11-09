import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { pool } from "./lib/db";
import { errorHandler } from "./middleware/errorHandler";
import { authRouter } from "./modules/auth/auth.routes";
import { notificationsRouter } from "./modules/notifications/notifications.routes";
import { requestsRouter } from "./modules/requests/requests.routes";
import { signaturesRouter } from "./modules/signatures/signatures.routes";

export function createApp() {
  const app = express();
  app.use(cors({ origin: env.CLIENT_ORIGIN }));
  app.use(express.json({ limit: "2mb" }));

  // Health check: confirms the API is up AND can reach PostgreSQL.
  app.get("/api/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok", db: "up" });
    } catch {
      res.status(503).json({ status: "error", db: "down" });
    }
  });

  app.use("/api/auth", authRouter);
  app.use("/api/requests", requestsRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/signature", signaturesRouter);

  app.use("/api", (_req, res) => { res.status(404).json({ error: "Not found" }); });

  app.use(errorHandler);

  return app;
}
