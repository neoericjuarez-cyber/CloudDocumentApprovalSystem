import type { EventInfo, LoadRevisionPermit, RequestItem } from "@/types";

const DETAIL_LABELS: Record<string, string> = {
  program: "Program", yearLevel: "Year level", currentProgram: "Current program",
  intendedProgram: "Intended program", academicYear: "Academic year", semester: "Semester",
};

export function permitReasons(p: LoadRevisionPermit) {
  return [p.conflict && "Conflict of schedule", p.dissolved && "Subject/s dissolved", p.otherReason && `Other: ${p.otherReason}`]
    .filter(Boolean).join("; ") || "—";
}

/** Everything a screen needs to describe a request, whatever form it came from. */
export function requestFacts(r: RequestItem) {
  const p = r.permit;
  const d = r.details ?? {};
  const infos: [string, string][] = [["Student ID", r.studentNo ?? p?.studentId ?? "—"], ["Full name", r.student]];
  if (p) infos.push(["Course and year", p.courseYear], ["Academic term", `${p.term}, SY ${p.schoolYear}`], ["Load (units)", `${p.loadBeforeUnits} → ${p.loadAfterUnits}`]);
  else for (const [key, label] of Object.entries(DETAIL_LABELS)) if (d[key]) infos.push([label, d[key]]);
  return {
    infos,
    reason: p ? permitReasons(p) : d.reason || "—",
    program: p ? p.courseYear : d.currentProgram || d.program || "—",
    yearLevel: d.yearLevel || "—",
  };
}

export function eventTitle(e: EventInfo) {
  switch (e.action) {
    case "submitted": return "Request submitted";
    case "resubmitted": return "Resubmitted after revision";
    case "approved": return `Approved by ${e.actorPosition ?? "approver"}`;
    case "returned": return `Returned by ${e.actorPosition ?? "approver"}`;
    case "rejected": return `Rejected by ${e.actorPosition ?? "approver"}`;
  }
}

export function eventText(e: EventInfo, r: RequestItem) {
  if (e.action === "submitted") return `${r.student} submitted the document for approval.`;
  if (e.action === "resubmitted") return `${r.student} revised and resubmitted the document.`;
  if (e.comment) return `“${e.comment}”`;
  return e.action === "approved" ? `${e.actorName ?? "The approver"} approved this request.` : "No comment was left.";
}
