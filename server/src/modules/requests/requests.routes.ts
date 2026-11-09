import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { HttpError } from "../../lib/errors";
import { FORM_TYPES } from "../../lib/workflow";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import * as svc from "./requests.service";

const createSchema = z.object({ type: z.enum(FORM_TYPES), data: z.unknown() });
const updateSchema = z.object({ data: z.unknown() });
const approveSchema = z.object({ comment: z.string().trim().max(1000).optional() });
const reasonSchema = z.object({ reason: z.string().trim().min(1, "A reason is required").max(1000) });

// e.g. IIT-2025-1048. Anything else can't exist, so answer 404 without touching the database.
const checkRef: RequestHandler = (req, _res, next) => {
  if (!/^IIT-\d{4}-\d{1,9}$/.test(String(req.params.ref))) throw new HttpError(404, "Request not found");
  next();
};

export const requestsRouter = Router();
requestsRouter.use(requireAuth);

requestsRouter.get("/", async (req, res) => {
  res.json({ requests: await svc.listRequests(req.user!) });
});

requestsRouter.post("/", requireRole("student"), validateBody(createSchema), async (req, res) => {
  res.status(201).json({ request: await svc.createRequest(req.user!, req.body.type, req.body.data) });
});

requestsRouter.get("/:ref", checkRef, async (req, res) => {
  res.json({ request: await svc.getRequest(req.user!, String(req.params.ref)) });
});

requestsRouter.get("/:ref/pdf", checkRef, async (req, res) => {
  const ref = String(req.params.ref);
  const pdf = await svc.getRequestPdf(req.user!, ref);
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${ref}.pdf"`,   // ref is validated by checkRef: letters, digits and dashes only
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  }).send(pdf);
});

requestsRouter.put("/:ref", checkRef, requireRole("student"), validateBody(updateSchema), async (req, res) => {
  res.json({ request: await svc.resubmitRequest(req.user!, String(req.params.ref), req.body.data) });
});

requestsRouter.post("/:ref/approve", checkRef, requireRole("approver"), validateBody(approveSchema), async (req, res) => {
  res.json({ request: await svc.decide(req.user!, String(req.params.ref), "approve", req.body.comment ?? null) });
});
requestsRouter.post("/:ref/return", checkRef, requireRole("approver"), validateBody(reasonSchema), async (req, res) => {
  res.json({ request: await svc.decide(req.user!, String(req.params.ref), "return", req.body.reason) });
});
requestsRouter.post("/:ref/reject", checkRef, requireRole("approver"), validateBody(reasonSchema), async (req, res) => {
  res.json({ request: await svc.decide(req.user!, String(req.params.ref), "reject", req.body.reason) });
});
