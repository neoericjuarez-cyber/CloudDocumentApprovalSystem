import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import * as svc from "./signatures.service";

const saveSchema = z.object({ imageData: z.string().max(220_000, "That signature image is too large") });

// Only approvers have signatures. Each person can only ever see and change their own.
export const signaturesRouter = Router();
signaturesRouter.use(requireAuth, requireRole("approver"));

signaturesRouter.get("/", async (req, res) => {
  res.json({ signature: await svc.getSignature(req.user!.id) });
});

signaturesRouter.put("/", validateBody(saveSchema), async (req, res) => {
  res.json({ signature: await svc.saveSignature(req.user!.id, req.body.imageData) });
});

signaturesRouter.delete("/", async (req, res) => {
  await svc.deleteSignature(req.user!.id);
  res.json({ ok: true });
});
