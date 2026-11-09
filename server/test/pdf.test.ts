// The official PDFs: who may download them, when, and that they really contain the signatures.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import bcrypt from "bcryptjs";

process.env.LOGIN_RATE_LIMIT_MAX = "100000";
const { createApp } = await import("../src/app");
const { pool, query } = await import("../src/lib/db");
const { pdfText } = await import("../src/modules/requests/requests.pdf");

const PASSWORD = "password123";
const ANDREA = "andrea.santos@g.msuiit.edu.ph", MIGUEL = "miguel.ramos@g.msuiit.edu.ph", ADVISER = "ramon.flores@msuiit.edu.ph", CHAIR = "maria.reyes@msuiit.edu.ph", DEAN = "jose.villanueva@msuiit.edu.ph";

let base = "";
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
const tokens: Record<string, string> = {};
const created: string[] = [];

async function call(who: string | null, method: string, path: string, body?: unknown) {
  return fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const json = async (who: string | null, method: string, path: string, body?: unknown) => { const r = await call(who, method, path, body); return { status: r.status, body: (await r.json().catch(() => null)) as any }; };
async function pdf(who: string | null, ref: string) {
  const r = await call(who, "GET", `/api/requests/${ref}/pdf`);
  return { res: r, bytes: Buffer.from(await r.arrayBuffer()) };
}
async function finish(type: string, data: unknown) {
  const make = await json(ANDREA, "POST", "/api/requests", { type, data });
  assert.equal(make.status, 201, JSON.stringify(make.body)); created.push(make.body.request.id);
  for (const who of [ADVISER, CHAIR, DEAN]) assert.equal((await json(who, "POST", `/api/requests/${make.body.request.id}/approve`, {})).status, 200);
  return make.body.request.id as string;
}
const imageCount = (b: Buffer) => (b.toString("latin1").match(/\/Subtype \/Image/g) ?? []).length;

const permit = (over: object = {}) => ({
  term: "2nd Semester", schoolYear: "2024–2025", familyName: "Santos", givenName: "Andrea", middleName: "M.", studentId: "2021-1234", permitDate: "2025-05-26",
  college: "College of Computer Studies", department: "Information Technology Department", courseYear: "BS Information Technology – 4th Year",
  withdraw: [{ course: "IT 138 – A", title: "Information Assurance and Security", units: "3" }],
  add: [{ course: "IT 141 – B", title: "Systems Integration and Architecture", units: "3", closed: true }],
  loadBeforeUnits: "18", loadBeforeHours: "21", loadAfterUnits: "18", loadAfterHours: "21", conflict: true, dissolved: false, otherReason: "", studentSignature: "Andrea M. Santos", ...over,
});
const leave = (reason = "Family reasons") => ({ program: "BS Information Technology", yearLevel: "4th Year", academicYear: "2024–2025", semester: "Second semester", reason });
const shifter = (reason = "Better fit") => ({ program: "BS Information Technology", yearLevel: "3rd Year", currentProgram: "BS Information Technology", intendedProgram: "BS Computer Science", reason });

before(async () => {
  assert.ok((await query("SELECT 1 FROM users WHERE email = $1", [ANDREA])).rowCount, "Not seeded. Run: npm run db:migrate && npm run db:seed");
  server = createApp().listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  for (const email of [ANDREA, MIGUEL, ADVISER, CHAIR, DEAN]) tokens[email] = (await json(null, "POST", "/api/auth/login", { email, password: PASSWORD })).body.token;
});
after(async () => {
  if (created.length) await query("DELETE FROM requests WHERE reference_no = ANY($1)", [created]);
  server.close();
  await pool.end();
});

describe("a fully approved request", () => {
  for (const [name, type, data] of [["permit", "Load Revision Form", permit()], ["Leave of Absence form", "Leave of Absence Form", leave()], ["Shifter's form", "Shifter's Application Form", shifter()]] as const) {
    it(`produces a real PDF for the ${name}, with all three signatures embedded`, async () => {
      const ref = await finish(type, data);
      const { res, bytes } = await pdf(ANDREA, ref);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "application/pdf");
      assert.equal(res.headers.get("content-disposition"), `attachment; filename="${ref}.pdf"`);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("cache-control"), "private, no-store");
      assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
      assert.ok(bytes.subarray(-8).toString("ascii").includes("%%EOF"));
      assert.ok(bytes.length > 5000, `only ${bytes.length} bytes`);
      // Each transparent PNG is stored as two image objects (the picture and its transparency mask): 3 signatures = 6.
      assert.equal(imageCount(bytes), 6, "the three approvers' signature images");
    });
  }

  it("is available to the people in the chain, but not to other students or the signed-out", async () => {
    const ref = await finish("Leave of Absence Form", leave());
    assert.equal((await pdf(ANDREA, ref)).res.status, 200);
    assert.equal((await pdf(ADVISER, ref)).res.status, 200);
    assert.equal((await pdf(DEAN, ref)).res.status, 200);
    assert.equal((await pdf(MIGUEL, ref)).res.status, 404);     // someone else's document
    assert.equal((await pdf(null, ref)).res.status, 401);
  });

  it("copes with unusual text: other alphabets, emoji and markup are drawn as plain text", async () => {
    const ref = await finish("Leave of Absence Form", leave("Zoë 😀 日本語 <script>alert(1)</script> 'quotes' \"double\" & more " + "very long ".repeat(60)));
    const { res, bytes } = await pdf(ANDREA, ref);
    assert.equal(res.status, 200);
    assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
  });

  it("copes with a long permit (many subjects)", async () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ course: `IT ${100 + i} – A`, title: `A fairly long course title number ${i + 1} for wrapping`, units: "3" }));
    const ref = await finish("Load Revision Form", permit({ withdraw: rows, add: rows.map(r => ({ ...r, closed: false })), otherReason: "x ".repeat(200) }));
    const { res, bytes } = await pdf(ANDREA, ref);
    assert.equal(res.status, 200);
    assert.ok(bytes.length > 5000);
  });
});

describe("a request that is not finished", () => {
  it("has no PDF yet (409), whether it is pending, returned or rejected", async () => {
    const pending = await json(ANDREA, "POST", "/api/requests", { type: "Leave of Absence Form", data: leave() }); created.push(pending.body.request.id);
    assert.equal((await pdf(ANDREA, pending.body.request.id)).res.status, 409);
    await json(ADVISER, "POST", `/api/requests/${pending.body.request.id}/approve`, {});
    assert.equal((await pdf(ANDREA, pending.body.request.id)).res.status, 409);               // 1 of 3 approvals is not enough
    await json(CHAIR, "POST", `/api/requests/${pending.body.request.id}/reject`, { reason: "No" });
    assert.equal((await pdf(ANDREA, pending.body.request.id)).res.status, 409);
    assert.equal((await pdf(ANDREA, "IIT-2025-0987")).res.status, 409);                          // the seeded returned request
  });
  it("answers 404 for a reference that does not exist or is malformed", async () => {
    assert.equal((await pdf(ANDREA, "IIT-2025-999999")).res.status, 404);
    assert.equal((await pdf(ANDREA, "nonsense")).res.status, 404);
  });
});

describe("pdfText", () => {
  it("replaces characters the PDF fonts can't draw instead of printing garbage", () => {
    assert.equal(pdfText("Zoë"), "Zoë");
    assert.equal(pdfText("Peña – “quoted”"), "Peña – “quoted”");
    assert.equal(pdfText("日本語"), "???");
    assert.equal(pdfText("😀"), "??");
    assert.equal(pdfText("a\u0000b\nc"), "a b c");
    assert.equal(pdfText(null), "");
  });
});
