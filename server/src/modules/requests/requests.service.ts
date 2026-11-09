import { query, withTransaction } from "../../lib/db";
import { HttpError } from "../../lib/errors";
import { buildSteps, type FormType, type Position, type StepStatus } from "../../lib/workflow";
import type { PublicUser } from "../auth/auth.service";
import { notifyPosition, notifyUser } from "../notifications/notifications.service";
import { renderRequestPdf } from "./requests.pdf";
import { parseRequestData } from "./requests.schemas";

type RequestStatus = "Pending" | "Approved" | "Rejected" | "Returned for Revision" | "Completed";

// The permit form's signature boxes are named differently from our positions.
const SLOT: Record<Position, string> = { Adviser: "Adviser", Chairperson: "Chairperson", "College Dean": "Dean" };

// What an approver sees as the status of a request = the status of THEIR step, not the whole request.
const STEP_AS_STATUS: Record<StepStatus, RequestStatus> = {
  Waiting: "Pending", Pending: "Pending", Approved: "Approved", Rejected: "Rejected", Returned: "Returned for Revision",
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/* ------------------------------------------------------------------ reading */

const BASE_SELECT = `
  SELECT r.id, r.reference_no, r.type, r.status, r.current_step, r.return_reason, r.data, r.created_at,
         u.name AS student_name, u.student_no, u.email AS student_email
    FROM requests r JOIN users u ON u.id = r.student_id`;

// SQL INJECTION SAFETY: every query this module can run for reading requests is written out in full below.
// Nothing a user types is ever pasted into SQL text. Values travel separately as $1/$2 parameters, so the
// database always treats them as data and never as commands. (test/sql-safety.test.ts fails if code ever
// builds SQL text from a variable.)
const ORDER_NEWEST_FIRST = "ORDER BY r.created_at DESC, r.reference_no DESC";
const STUDENT_SCOPE = "r.student_id = $1";
const APPROVER_SCOPE = "EXISTS (SELECT 1 FROM request_steps s WHERE s.request_id = r.id AND s.position = $1 AND s.status <> 'Waiting')";
const BY_REFERENCE = "AND r.reference_no = $2";
const REQUEST_QUERIES = {
  student: {
    list: `${BASE_SELECT} WHERE ${STUDENT_SCOPE} ${ORDER_NEWEST_FIRST}`,
    one: `${BASE_SELECT} WHERE ${STUDENT_SCOPE} ${BY_REFERENCE} ${ORDER_NEWEST_FIRST}`,
  },
  approver: {
    list: `${BASE_SELECT} WHERE ${APPROVER_SCOPE} ${ORDER_NEWEST_FIRST}`,
    one: `${BASE_SELECT} WHERE ${APPROVER_SCOPE} ${BY_REFERENCE} ${ORDER_NEWEST_FIRST}`,
  },
} as const;

/**
 * Who may see a request: a student sees their own; an approver sees requests whose approval chain has
 * reached (or passed) their position. Everyone else gets "not found", so reference numbers can't be probed.
 * `detail` adds the history and the signature images (kept out of lists to keep them small).
 */
async function fetchRequests(user: PublicUser, opts: { ref?: string; detail?: boolean } = {}) {
  const scope = user.role === "student" ? "student" : "approver";
  const params: unknown[] = [scope === "student" ? user.id : user.position];
  if (opts.ref) params.push(opts.ref);
  const { rows } = await query(REQUEST_QUERIES[scope][opts.ref ? "one" : "list"], params);
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);

  const steps = (await query(
    `SELECT s.request_id, s.step_order, s.position, s.status, s.comment, s.acted_at, s.signature_image, a.name AS actor_name
       FROM request_steps s LEFT JOIN users a ON a.id = s.acted_by
      WHERE s.request_id = ANY($1::uuid[]) ORDER BY s.step_order`, [ids])).rows;
  const events = opts.detail ? (await query(
    `SELECT e.request_id, e.action, e.comment, e.created_at, a.name AS actor_name, a.position AS actor_position
       FROM request_events e LEFT JOIN users a ON a.id = e.actor_id
      WHERE e.request_id = ANY($1::uuid[]) ORDER BY e.created_at, e.id`, [ids])).rows : null;

  return rows.map(row => toDto(
    row, steps.filter(s => s.request_id === row.id), events ? events.filter(e => e.request_id === row.id) : null, user));
}

function toDto(row: any, stepRows: any[], eventRows: any[] | null, viewer: PublicUser) {
  const steps = stepRows.map(s => ({
    order: s.step_order as number, position: s.position as Position, status: s.status as StepStatus,
    actorName: (s.actor_name ?? null) as string | null, comment: (s.comment ?? null) as string | null, actedAt: iso(s.acted_at),
    signed: Boolean(s.signature_image),
    // The image itself is only sent when one request is opened, never in lists (they'd be huge).
    signatureImage: eventRows ? ((s.signature_image ?? null) as string | null) : undefined,
  }));

  const mine = viewer.role === "approver" ? steps.find(s => s.position === viewer.position) : undefined;
  const status: RequestStatus = mine ? STEP_AS_STATUS[mine.status] : row.status;

  const stopped = steps.find(s => s.status === "Returned" || s.status === "Rejected");
  const stage =
    row.status === "Pending" ? (steps.find(s => s.order === row.current_step)?.position ?? "Pending")
    : row.status === "Completed" ? "Completed"
    : `${row.status === "Rejected" ? "Rejected" : "Returned"} by ${stopped?.position ?? "approver"}`;

  const isPermit = row.type === "Load Revision Form";
  const signatures: Record<string, string> = {};
  const signatureImages: Record<string, string> = {};
  for (const s of steps) {
    if (s.status !== "Approved" || !s.actorName) continue;
    signatures[SLOT[s.position]] = s.actorName;
    if (s.signatureImage) signatureImages[SLOT[s.position]] = s.signatureImage;
  }

  return {
    id: row.reference_no as string,
    type: row.type as string,
    student: row.student_name as string,
    studentNo: (row.student_no ?? null) as string | null,
    studentEmail: row.student_email as string,
    createdAt: iso(row.created_at)!,
    status, stage,
    reason: (row.return_reason ?? null) as string | null,
    permit: isPermit ? { ...row.data, signatures, ...(eventRows ? { signatureImages } : {}) } : undefined,
    details: isPermit ? undefined : (row.data as Record<string, string>),
    steps,
    events: eventRows?.map(e => ({
      action: e.action as string, comment: (e.comment ?? null) as string | null, at: iso(e.created_at)!,
      actorName: (e.actor_name ?? null) as string | null, actorPosition: (e.actor_position ?? null) as Position | null,
    })),
  };
}

export type RequestDto = Awaited<ReturnType<typeof getRequest>>;

export const listRequests = (user: PublicUser) => fetchRequests(user);

export async function getRequest(user: PublicUser, ref: string) {
  const [found] = await fetchRequests(user, { ref, detail: true });
  if (!found) throw new HttpError(404, "Request not found");
  return found;
}

/* ----------------------------------------------------------------- creating */

/** Parses + cleans the form data. The account's own student number always wins over what the form says. */
function prepareData(user: PublicUser, type: FormType, raw: unknown) {
  const data = parseRequestData(type, raw);
  if (type === "Load Revision Form" && user.studentNo) data.studentId = user.studentNo;
  return data;
}

export async function createRequest(user: PublicUser, type: FormType, raw: unknown) {
  if (user.role !== "student") throw new HttpError(403, "Only students can submit requests");
  const data = prepareData(user, type, raw);
  const steps = buildSteps(type);

  const ref = await withTransaction(async db => {
    const n = (await db.query("SELECT nextval('request_ref_seq') AS n")).rows[0].n;
    const reference = `IIT-${new Date().getFullYear()}-${n}`;
    const { rows } = await db.query(
      `INSERT INTO requests (reference_no, type, student_id, status, current_step, data)
       VALUES ($1,$2,$3,'Pending',1,$4) RETURNING id`, [reference, type, user.id, JSON.stringify(data)]);
    const requestId = rows[0].id as string;

    for (const s of steps)
      await db.query("INSERT INTO request_steps (request_id, step_order, position, status) VALUES ($1,$2,$3,$4)",
        [requestId, s.stepOrder, s.position, s.status]);
    await db.query("INSERT INTO request_events (request_id, actor_id, action) VALUES ($1,$2,'submitted')", [requestId, user.id]);

    await notifyUser(db, user.id, { requestId, kind: "file", title: "Document submitted successfully",
      message: `${reference} is now with the ${steps[0].position}.` });
    await notifyPosition(db, steps[0].position, { requestId, kind: "file", title: "New document awaiting review",
      message: `${user.name} submitted a ${type} (${reference}).` });
    return reference;
  });
  return getRequest(user, ref);
}

/** The student edits a request that was returned for revision. The approval chain starts over. */
export async function resubmitRequest(user: PublicUser, ref: string, raw: unknown) {
  await withTransaction(async db => {
    const found = (await db.query(
      "SELECT id, type, status FROM requests WHERE reference_no = $1 AND student_id = $2 FOR UPDATE", [ref, user.id])).rows[0];
    if (!found) throw new HttpError(404, "Request not found");
    if (found.status !== "Returned for Revision")
      throw new HttpError(409, "Only requests that were returned for revision can be edited");

    const data = prepareData(user, found.type, raw);
    await db.query(
      `UPDATE requests SET data = $2, status = 'Pending', current_step = 1, return_reason = NULL, updated_at = now() WHERE id = $1`,
      [found.id, JSON.stringify(data)]);
    // Earlier signatures were for the old version of the form, so every step is reset.
    await db.query(
      `UPDATE request_steps SET status = CASE WHEN step_order = 1 THEN 'Pending' ELSE 'Waiting' END,
              acted_by = NULL, comment = NULL, acted_at = NULL, signature_image = NULL WHERE request_id = $1`, [found.id]);
    await db.query("INSERT INTO request_events (request_id, actor_id, action) VALUES ($1,$2,'resubmitted')", [found.id, user.id]);

    const first = (await db.query("SELECT position FROM request_steps WHERE request_id = $1 AND step_order = 1", [found.id])).rows[0];
    await notifyPosition(db, first.position, { requestId: found.id, kind: "rotate", title: "Request updated",
      message: `${user.name} revised and resubmitted ${ref}.` });
    await notifyUser(db, user.id, { requestId: found.id, kind: "file", title: "Revision submitted",
      message: `${ref} is back with the ${first.position}.` });
  });
  return getRequest(user, ref);
}

/* ---------------------------------------------------------------- deciding */

export type Decision = "approve" | "return" | "reject";

export async function decide(user: PublicUser, ref: string, decision: Decision, comment: string | null) {
  if (user.role !== "approver" || !user.position) throw new HttpError(403, "Only approvers can do this");
  const position = user.position;

  await withTransaction(async db => {
    // Lock the request and its steps so two simultaneous actions can't both succeed.
    const req = (await db.query(
      "SELECT id, status, current_step, type, student_id FROM requests WHERE reference_no = $1 FOR UPDATE", [ref])).rows[0];
    if (!req) throw new HttpError(404, "Request not found");
    const steps = (await db.query(
      "SELECT id, step_order, position, status FROM request_steps WHERE request_id = $1 ORDER BY step_order FOR UPDATE", [req.id])).rows;

    const mine = steps.find(s => s.position === position);
    if (!mine || mine.status === "Waiting") throw new HttpError(404, "Request not found");   // hasn't reached you
    const current = steps.find(s => s.step_order === req.current_step);
    if (req.status !== "Pending" || !current || current.position !== position)
      throw new HttpError(409, "This request is not waiting for your action");

    const studentName = (await db.query("SELECT name FROM users WHERE id = $1", [req.student_id])).rows[0].name as string;
    const act = (status: StepStatus, signatureImage: string | null = null) => db.query(
      "UPDATE request_steps SET status = $2, acted_by = $3, comment = $4, acted_at = now(), signature_image = $5 WHERE id = $1",
      [mine.id, status, user.id, comment, signatureImage]);
    const event = (action: string) => db.query(
      "INSERT INTO request_events (request_id, actor_id, action, comment) VALUES ($1,$2,$3,$4)", [req.id, user.id, action, comment]);
    const tellStudent = (kind: "check" | "rotate" | "x", title: string, message: string) =>
      notifyUser(db, req.student_id, { requestId: req.id, kind, title, message });

    if (decision === "approve") {
      // Approving means signing: the approver's saved signature is copied onto this step.
      const saved = (await db.query("SELECT image_data FROM signatures WHERE user_id = $1", [user.id])).rows[0];
      if (!saved) throw new HttpError(409, "Save your e-signature before approving. Open My E-Signature to create one.");
      await act("Approved", saved.image_data);
      await event("approved");
      const next = steps.find(s => s.step_order === mine.step_order + 1);
      if (next) {
        await db.query("UPDATE request_steps SET status = 'Pending' WHERE id = $1", [next.id]);
        await db.query("UPDATE requests SET current_step = $2, updated_at = now() WHERE id = $1", [req.id, next.step_order]);
        await tellStudent("check", `Approved by ${position}`, `${ref} was approved by ${user.name} and is now with the ${next.position}.`);
        await notifyPosition(db, next.position, { requestId: req.id, kind: "file", title: "New document awaiting review",
          message: `${studentName}'s ${req.type} (${ref}) was approved by the ${position}.` });
      } else {
        await db.query("UPDATE requests SET status = 'Completed', current_step = NULL, updated_at = now() WHERE id = $1", [req.id]);
        await tellStudent("check", "Your document was approved", `${ref} has received final approval.`);
      }
    } else if (decision === "return") {
      await act("Returned");
      await event("returned");
      await db.query("UPDATE requests SET status = 'Returned for Revision', return_reason = $2, updated_at = now() WHERE id = $1", [req.id, comment]);
      await tellStudent("rotate", "Revision requested", `${ref} was returned by the ${position}: ${comment}`);
    } else {
      await act("Rejected");
      await event("rejected");
      await db.query("UPDATE requests SET status = 'Rejected', current_step = NULL, return_reason = $2, updated_at = now() WHERE id = $1", [req.id, comment]);
      await tellStudent("x", "Request rejected", `${ref} was rejected by the ${position}: ${comment}`);
    }
  });
  return getRequest(user, ref);
}

/* -------------------------------------------------------------------- PDF */

/** The official PDF. Same access rules as viewing the request, and only once every approval is in. */
export async function getRequestPdf(user: PublicUser, ref: string) {
  const dto = await getRequest(user, ref);
  if (dto.steps.length === 0 || !dto.steps.every(s => s.status === "Approved"))
    throw new HttpError(409, "The PDF is available once all approvals are complete");
  return renderRequestPdf(dto);
}
