import type { RequestItem } from "@/types";
import { saveBlob } from "./download";

/**
 * One CSV cell. Two protections:
 *  - values with commas, quotes or line breaks are quoted;
 *  - a value starting with = + - @ (or a tab/CR) would run as a FORMULA when opened in Excel, so a leading '
 *    is added. Otherwise a student could type =HYPERLINK(...) into a form and have it execute on a staff member's computer.
 */
export function csvCell(value: unknown): string {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function requestsToCsv(rows: RequestItem[], includeStudent: boolean): string {
  const header = ["Reference", "Document", ...(includeStudent ? ["Student"] : []), "Student ID", "Submitted", "Current stage", "Status"];
  const lines = rows.map(r => [r.id, r.type, ...(includeStudent ? [r.student] : []), r.studentNo ?? "", r.createdAt.slice(0, 10), r.stage, r.status]);
  return [header, ...lines].map(line => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function exportRequestsCsv(rows: RequestItem[], includeStudent: boolean) {
  // The byte-order mark makes Excel read accents and other alphabets correctly.
  const blob = new Blob(["\ufeff" + requestsToCsv(rows, includeStudent)], { type: "text/csv;charset=utf-8" });
  saveBlob(blob, `requests-${new Date().toISOString().slice(0, 10)}.csv`);
}
