// Builds the PDF of a fully approved request. Text is only ever drawn as text (never interpreted),
// so nothing a student typed can change the document's structure.
import PDFDocument from "pdfkit";
import type { RequestDto } from "./requests.service";

type Doc = InstanceType<typeof PDFDocument>;
type SubjectRow = { course: string; title: string; units: string; closed?: boolean };
// The permit's content as stored (already validated by requests.schemas.ts before it was saved).
type PermitContent = {
  term: string; schoolYear: string; familyName: string; givenName: string; middleName: string; studentId: string;
  permitDate: string; college: string; department: string; courseYear: string; withdraw: SubjectRow[]; add: SubjectRow[];
  loadBeforeUnits: string; loadBeforeHours: string; loadAfterUnits: string; loadAfterHours: string;
  conflict: boolean; dissolved: boolean; otherReason: string;
};

const L = 36, W = 523.28, INK = "#111111", MUTED = "#555555", MAROON = "#7a1f3d", GRID = "#222222";

/** Standard PDF fonts only cover Latin-1 plus a few punctuation marks; anything else becomes "?". */
export const pdfText = (v: unknown) =>
  String(v ?? "").normalize("NFC").replace(/[\u0000-\u001f]/g, " ")
    .replace(/[^\u0020-\u007e\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026]/g, "?");

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" }) : "";

const DETAIL_LABELS: Record<string, string> = {
  program: "Program", yearLevel: "Year level", currentProgram: "Current program",
  intendedProgram: "Intended program", academicYear: "Academic year", semester: "Semester",
};

const ESIGN_SLOTS = [["Adviser", "Adviser"], ["Chairperson", "Chairperson"], ["College Dean", "Dean"]] as const;

function text(doc: Doc, s: unknown, x: number, y: number, o: { w?: number; size?: number; bold?: boolean; color?: string; align?: "left" | "center" | "right" } = {}) {
  doc.font(o.bold ? "Helvetica-Bold" : "Helvetica").fontSize(o.size ?? 9).fillColor(o.color ?? INK)
    .text(pdfText(s), x, y, { width: o.w, align: o.align ?? "left", lineBreak: o.w !== undefined });
}
const heightOf = (doc: Doc, s: unknown, w: number, size: number, bold = false) =>
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).heightOfString(pdfText(s) || " ", { width: w });
const box = (doc: Doc, x: number, y: number, w: number, h: number) => doc.lineWidth(0.8).strokeColor(GRID).rect(x, y, w, h).stroke();

function header(doc: Doc, dto: RequestDto, title: string, code?: string) {
  const y = 36;
  box(doc, L, y, W, 58);
  doc.moveTo(L + 62, y).lineTo(L + 62, y + 58).moveTo(L + 322, y).lineTo(L + 322, y + 58).stroke();
  text(doc, "MSU", L, y + 17, { w: 62, size: 13, bold: true, align: "center" });
  text(doc, "IIT", L, y + 31, { w: 62, size: 13, bold: true, align: "center" });
  text(doc, "ILIGAN INSTITUTE OF TECHNOLOGY", L + 62, y + 17, { w: 260, size: 11, bold: true, align: "center" });
  text(doc, "MINDANAO STATE UNIVERSITY", L + 62, y + 33, { w: 260, size: 9, align: "center" });
  text(doc, "OFFICE OF THE REGISTRAR", L + 322, y + 8, { w: W - 322, size: 7.5, bold: true, align: "center" });
  if (code) {
    text(doc, "Document Code No.", L + 322, y + 21, { w: W - 322, size: 7, align: "center" });
    text(doc, code, L + 322, y + 31, { w: W - 322, size: 10, bold: true, align: "center", color: MAROON });
    text(doc, "Revision No. 00 · Effective 02.20.2020", L + 322, y + 46, { w: W - 322, size: 6.5, align: "center", color: MUTED });
  } else {
    text(doc, "Reference No.", L + 322, y + 21, { w: W - 322, size: 7, align: "center" });
    text(doc, dto.id, L + 322, y + 31, { w: W - 322, size: 10, bold: true, align: "center", color: MAROON });
  }
  text(doc, title, L, y + 70, { w: W, size: 13, bold: true, align: "center" });
  return y + 94;
}

function signatureBlock(doc: Doc, dto: RequestDto, x: number, y: number, w: number, position: string, extra?: string) {
  const step = dto.steps.find(s => s.position === position);
  const signed = step?.status === "Approved";
  text(doc, position, x, y, { w, size: 8.5, bold: true, align: "center" });
  if (signed && step?.signatureImage) {
    try { doc.image(Buffer.from(step.signatureImage.split(",")[1], "base64"), x + 8, y + 12, { fit: [w - 16, 36], align: "center", valign: "center" }); } catch { /* unreadable image: leave the line blank */ }
  }
  doc.lineWidth(0.7).strokeColor("#333333").moveTo(x + 6, y + 52).lineTo(x + w - 6, y + 52).stroke();
  text(doc, signed ? step!.actorName : "", x, y + 55, { w, size: 8, bold: true, align: "center" });
  text(doc, "Signature over Printed Name", x, y + 66, { w, size: 6, align: "center", color: MUTED });
  text(doc, signed ? `Date: ${fmtDate(step!.actedAt)}` : "Date: ____________", x, y + 77, { w, size: 7.5, align: "center" });
  if (extra) text(doc, extra, x, y + 90, { w, size: 7, align: "center" });
}

function footer(doc: Doc, dto: RequestDto, y: number) {
  doc.lineWidth(0.6).strokeColor(GRID).moveTo(L, y).lineTo(L + W, y).stroke();
  text(doc, "A. Bonifacio Avenue, Tibanga, 9200 Iligan City  ·  www.msuiit.edu.ph  ·  registrar@g.msuiit.edu.ph", L, y + 5, { w: W, size: 6.5, align: "center", color: MUTED });
  text(doc, `Approved electronically through the MSU-IIT Document Approval System  ·  Reference ${dto.id}  ·  Generated ${fmtDate(new Date().toISOString())}`, L, y + 15, { w: W, size: 6.5, align: "center", color: MUTED });
}

/* ------------------------------------------------------------ the permit */

function permitPdf(doc: Doc, dto: RequestDto) {
  const p = dto.permit as PermitContent;
  let y = header(doc, dto, "ACADEMIC LOAD REVISION PERMIT", "FM-MSU-IIT-RGTR-008");
  const LABEL = 52, CW = W - LABEL, CX = L + LABEL;
  const part = (n: number, h: number, draw: (y: number) => void) => {
    box(doc, L, y, W, h); doc.moveTo(CX, y).lineTo(CX, y + h).stroke();
    text(doc, `PART ${n}`, L, y + h / 2 - 4, { w: LABEL, size: 8, bold: true, align: "center" });
    draw(y); y += h;
  };
  const check = (x: number, cy: number, on: boolean) => {
    doc.lineWidth(0.8).strokeColor(GRID).rect(x, cy, 8, 8).stroke();
    if (on) doc.moveTo(x + 1.5, cy + 1.5).lineTo(x + 6.5, cy + 6.5).moveTo(x + 6.5, cy + 1.5).lineTo(x + 1.5, cy + 6.5).stroke();
  };
  const labelled = (label: string, value: string, x: number, yy: number, w: number) => {
    text(doc, label, x, yy, { w, size: 6, color: MUTED });
    text(doc, value || "—", x, yy + 9, { w, size: 9, bold: true });
  };

  part(1, 26, yy => {
    let x = CX + 12;
    for (const [term, label] of [["1st Semester", "1ST Semester"], ["2nd Semester", "2ND Semester"], ["Summer Term", "Summer Term"]] as const) {
      check(x, yy + 9, p.term === term); text(doc, label, x + 12, yy + 9, { size: 8.5 }); x += 100;
    }
    text(doc, `School Year: ${p.schoolYear}`, CX + CW - 140, yy + 9, { w: 130, size: 8.5, bold: true, align: "right" });
  });
  part(2, 32, yy => {
    const full = `${p.familyName}, ${p.givenName} ${p.middleName}`.trim();
    labelled("FULL NAME (Family, Given, Middle)", full, CX + 6, yy + 5, 250);
    labelled("I.D. No.", p.studentId, CX + 270, yy + 5, 90);
    labelled("Date", p.permitDate, CX + 372, yy + 5, 95);
  });
  part(3, 32, yy => {
    labelled("COLLEGE / SCHOOL", p.college, CX + 6, yy + 5, 150);
    labelled("DEPARTMENT", p.department, CX + 162, yy + 5, 150);
    labelled("COURSE & YEAR", p.courseYear, CX + 318, yy + 5, 150);
  });

  // PART 4 and 5: tables. Controller / Professor boxes are left empty: they are completed on the printed copy.
  const table = (n: number, title: string, cols: Array<[string, number]>, rows: string[][]) => {
    const rowH = (r: string[]) => Math.max(24, ...r.map((c, i) => heightOf(doc, c, cols[i][1] - 6, 8.5) + 10));
    const heights = rows.map(rowH);
    const total = 18 + 14 + heights.reduce((a, b) => a + b, 0);
    part(n, total, yy => {
      text(doc, title, CX + 6, yy + 5, { w: CW - 12, size: 8, bold: true });
      let cy = yy + 18; let x = CX;
      doc.rect(CX, cy, CW, 14).fill("#f1f1f1"); doc.strokeColor(GRID);
      cols.forEach(([name, w]) => { text(doc, name, x, cy + 4, { w, size: 6, bold: true, align: "center" }); x += w; });
      cy += 14;
      doc.lineWidth(0.6).strokeColor(GRID).moveTo(CX, yy + 18).lineTo(CX + CW, yy + 18).stroke();
      rows.forEach((r, ri) => {
        doc.moveTo(CX, cy).lineTo(CX + CW, cy).stroke();
        let cx = CX;
        r.forEach((c, i) => { text(doc, c, cx + 3, cy + 5, { w: cols[i][1] - 6, size: 8.5, align: cols[i][0] === "UNITS" ? "center" : "left" }); cx += cols[i][1]; });
        cy += heights[ri];
      });
      let cx = CX; cols.slice(0, -1).forEach(([, w]) => { cx += w; doc.moveTo(cx, yy + 18).lineTo(cx, yy + total).stroke(); });
    });
  };
  const dash = (v: string) => v || "—";
  table(4, "WITHDRAW from the following subject/s:", [["COURSE NO. & SEC.", 96], ["COURSE TITLE", 190], ["UNITS", 40], ["CONTROLLER", 72], ["PROFESSOR", 73]],
    p.withdraw.length ? p.withdraw.map(r => [dash(r.course), dash(r.title), dash(r.units), "", ""]) : [["—", "—", "—", "", ""]]);
  table(5, "ADD the following subject/s:", [["NO.", 28], ["COURSE NO. & SEC.", 92], ["COURSE TITLE", 174], ["UNITS", 38], ["CONTROLLER", 69], ["CLOSED SUBJECT", 70]],
    p.add.length ? p.add.map((r, i) => [String(i + 1), dash(r.course), dash(r.title), dash(r.units), "", r.closed ? "Closed (see printed copy)" : "Not applicable"]) : [["—", "—", "—", "—", "", ""]]);

  part(6, 28, yy => {
    text(doc, `TOTAL LOAD before Revision ${p.loadBeforeUnits} units; ${p.loadBeforeHours} hours/week`, CX + 6, yy + 10, { w: 220, size: 8, bold: true });
    text(doc, `TOTAL LOAD after Revision ${p.loadAfterUnits} units; ${p.loadAfterHours} hours/week`, CX + 236, yy + 10, { w: 220, size: 8, bold: true });
  });
  const otherH = heightOf(doc, p.otherReason || "—", CW - 90, 8.5);
  part(7, 40 + Math.max(0, otherH - 10), yy => {
    text(doc, "REASON/S for Load Revision", CX + 6, yy + 5, { size: 8, bold: true });
    check(CX + 8, yy + 20, p.conflict); text(doc, "Conflict of Schedule", CX + 20, yy + 20, { size: 8.5 });
    check(CX + 140, yy + 20, p.dissolved); text(doc, "Subject/s Dissolved", CX + 152, yy + 20, { size: 8.5 });
    text(doc, `Other reason/s: ${p.otherReason || "—"}`, CX + 262, yy + 20, { w: CW - 270, size: 8.5 });
  });
  part(8, 124, yy => {
    text(doc, "APPROVAL:", CX + 6, yy + 4, { size: 8, bold: true });
    const bw = CW / 4;
    ESIGN_SLOTS.forEach(([pos], i) => signatureBlock(doc, dto, CX + i * bw, yy + 16, bw, pos, pos === "Adviser" ? "Assessment Php ____________" : pos === "Chairperson" ? "O.R. No. ____________" : undefined));
    text(doc, "Registrar", CX + 3 * bw, yy + 16, { w: bw, size: 8.5, bold: true, align: "center" });
    doc.lineWidth(0.7).strokeColor("#333333").moveTo(CX + 3 * bw + 6, yy + 68).lineTo(CX + 4 * bw - 6, yy + 68).stroke();
    text(doc, "Signature over Printed Name", CX + 3 * bw, yy + 71, { w: bw, size: 6, align: "center", color: MUTED });
    text(doc, "Date: ____________", CX + 3 * bw, yy + 93, { w: bw, size: 7.5, align: "center" });
  });
  text(doc, "Adviser, Chairperson and Dean approvals were recorded electronically with the signatures shown. The Controller, Professor/Instructor and Registrar boxes are completed on the printed copy.", L, y + 8, { w: W, size: 7, align: "center", color: MUTED });
  text(doc, "Accomplish in 3 copies – for the Registrar, the Department and the Student.", L, y + 28, { w: W, size: 7.5, align: "center" });
  footer(doc, dto, y + 50);
}

/* ------------------------------------------------- leave / shifter forms */

function genericPdf(doc: Doc, dto: RequestDto) {
  const d = dto.details ?? {};
  let y = header(doc, dto, dto.type.toUpperCase());
  text(doc, `Reference No. ${dto.id}   ·   Submitted ${fmtDate(dto.createdAt)}   ·   Status: APPROVED`, L, y - 8, { w: W, size: 8.5, align: "center", color: MUTED });
  y += 12;

  const section = (title: string) => { text(doc, title, L, y, { size: 9, bold: true, color: MAROON }); doc.lineWidth(0.8).strokeColor(MAROON).moveTo(L, y + 13).lineTo(L + W, y + 13).stroke(); y += 20; };
  const pair = (label: string, value: string, x: number, w: number, yy: number) => { text(doc, label, x, yy, { w, size: 6.5, color: MUTED }); text(doc, value || "—", x, yy + 9, { w, size: 10, bold: true }); };

  section("STUDENT INFORMATION");
  pair("FULL NAME", dto.student, L, 200, y); pair("STUDENT ID", dto.studentNo ?? "—", L + 215, 95, y); pair("EMAIL", dto.studentEmail ?? "—", L + 320, 203, y);
  y += 34;

  section("REQUEST DETAILS");
  const entries = Object.entries(d).filter(([k]) => k !== "reason");
  entries.sort(([a], [b]) => (Object.keys(DETAIL_LABELS).indexOf(a) + 1 || 99) - (Object.keys(DETAIL_LABELS).indexOf(b) + 1 || 99));
  entries.slice(0, 20).forEach(([k, v], i) => {
    const col = i % 2; if (col === 0 && i > 0) y += 30;
    pair((DETAIL_LABELS[k] ?? k).toUpperCase(), v, L + col * 270, 250, y);
  });
  y += entries.length ? 34 : 0;

  section("REASON");
  const reason = d.reason || "—";
  const rh = Math.max(50, heightOf(doc, reason, W - 16, 10) + 16);
  box(doc, L, y, W, rh); text(doc, reason, L + 8, y + 8, { w: W - 16, size: 10 }); y += rh + 20;

  section("APPROVALS");
  const bw = W / 3;
  ESIGN_SLOTS.forEach(([pos], i) => signatureBlock(doc, dto, L + i * bw, y, bw, pos));
  y += 110;
  footer(doc, dto, Math.max(y, 740));
}

export function renderRequestPdf(dto: RequestDto): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, info: { Title: `${dto.type} ${dto.id}`, Author: "MSU-IIT Document Approval System", Subject: dto.id } });
    const chunks: Buffer[] = [];
    doc.on("data", c => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    try { (dto.permit ? permitPdf : genericPdf)(doc, dto); doc.end(); } catch (e) { reject(e); }
  });
}
