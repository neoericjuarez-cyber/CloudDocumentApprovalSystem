// E-signatures: who can save one, what is accepted, and how a signature is stamped onto documents.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import bcrypt from "bcryptjs";

process.env.LOGIN_RATE_LIMIT_MAX = "100000";
const { createApp } = await import("../src/app");
const { pool, query } = await import("../src/lib/db");
const { makeSignaturePng } = await import("../src/db/demoSignature");

const PASSWORD = "password123";
const ANDREA = "andrea.santos@g.msuiit.edu.ph", ADVISER = "ramon.flores@msuiit.edu.ph", CHAIR = "maria.reyes@msuiit.edu.ph";
const TEMP = "temp.adviser@test.local";
const TEMP_PASSWORD = randomBytes(9).toString("hex");

let base = "";
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
const tokens: Record<string, string> = {};
const created: string[] = [];

async function http(who: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const png = (name: string) => `data:image/png;base64,${makeSignaturePng(name).toString("base64")}`;

/** A PNG that is valid as far as the header goes, with the given dimensions (and optional padding). */
function fakePng(width: number, height: number, padding = 0) {
  const ihdr = Buffer.alloc(25); ihdr.writeUInt32BE(13, 0); ihdr.write("IHDR", 4, "ascii"); ihdr.writeUInt32BE(width, 8); ihdr.writeUInt32BE(height, 12);
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(padding)]);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

before(async () => {
  assert.ok((await query("SELECT 1 FROM users WHERE email = $1", [ANDREA])).rowCount, "Not seeded. Run: npm run db:migrate && npm run db:seed");
  await query("DELETE FROM users WHERE email = $1", [TEMP]);
  await query("INSERT INTO users (email, password_hash, name, role, position) VALUES ($1,$2,'Temp Adviser','approver','Adviser')", [TEMP, await bcrypt.hash(TEMP_PASSWORD, 4)]);
  server = createApp().listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  for (const [email, pw] of [[ANDREA, PASSWORD], [ADVISER, PASSWORD], [CHAIR, PASSWORD], [TEMP, TEMP_PASSWORD]]) {
    tokens[email] = (await http(null, "POST", "/api/auth/login", { email, password: pw })).body.token;
  }
});
after(async () => {
  if (created.length) await query("DELETE FROM requests WHERE reference_no = ANY($1)", [created]);
  await query("DELETE FROM users WHERE email = $1", [TEMP]);
  server.close();
  await pool.end();
});

describe("access", () => {
  it("is for approvers only, and only ever your own", async () => {
    assert.equal((await http(null, "GET", "/api/signature")).status, 401);
    assert.equal((await http(ANDREA, "GET", "/api/signature")).status, 403);
    assert.equal((await http(ANDREA, "PUT", "/api/signature", { imageData: png("x") })).status, 403);
    assert.equal((await http(ANDREA, "DELETE", "/api/signature")).status, 403);
    const mine = await http(ADVISER, "GET", "/api/signature");
    assert.equal(mine.status, 200);
    assert.match(mine.body.signature.imageData, /^data:image\/png;base64,/);
  });
});

describe("what is accepted", () => {
  const refuse = async (imageData: unknown, why: string) => {
    const r = await http(TEMP, "PUT", "/api/signature", { imageData });
    assert.equal(r.status, 400, `${why}: expected 400, got ${r.status}`);
  };
  it("refuses everything that is not a small genuine PNG", async () => {
    await refuse("data:image/jpeg;base64,/9j/4AAQSkZJRg==", "JPEG");
    await refuse(`data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64")}`, "SVG with script");
    await refuse(`data:image/png;base64,${Buffer.from("this is not a png at all, just text pretending").toString("base64")}`, "PNG label on non-PNG bytes");
    await refuse("not a data url", "plain text");
    await refuse("data:image/png;base64,", "empty image");
    await refuse("data:text/html;base64,PGgxPmhpPC9oMT4=", "HTML");
    await refuse("javascript:alert(1)", "javascript URL");
    await refuse(fakePng(5000, 100), "too wide");
    await refuse(fakePng(100, 5000), "too tall");
    await refuse(fakePng(0, 0), "zero size");
    await refuse(fakePng(300, 100, 200_000), "too many bytes");
    await refuse(12345, "a number");
    await refuse(null, "null");
    assert.equal((await http(TEMP, "PUT", "/api/signature", {})).status, 400);
  });

  it("saves, returns, replaces and deletes a valid PNG", async () => {
    const a = png("Temp Adviser A"), b = png("Temp Adviser B");
    assert.deepEqual((await http(TEMP, "GET", "/api/signature")).body, { signature: null });
    assert.equal((await http(TEMP, "PUT", "/api/signature", { imageData: a })).status, 200);
    assert.equal((await http(TEMP, "GET", "/api/signature")).body.signature.imageData, a);
    assert.equal((await http(TEMP, "PUT", "/api/signature", { imageData: b })).status, 200);
    assert.equal((await http(TEMP, "GET", "/api/signature")).body.signature.imageData, b);
    assert.equal((await query("SELECT count(*)::int n FROM signatures s JOIN users u ON u.id = s.user_id WHERE u.email = $1", [TEMP])).rows[0].n, 1);   // replaced, not duplicated
    assert.equal((await http(TEMP, "DELETE", "/api/signature")).status, 200);
    assert.deepEqual((await http(TEMP, "GET", "/api/signature")).body, { signature: null });
  });
});

describe("signing a document", () => {
  const leave = { program: "BS Information Technology", yearLevel: "4th Year", academicYear: "2024–2025", semester: "Second semester", reason: "Signature test" };

  it("needs a saved signature, stamps a copy of it, and keeps that copy if the signature changes later", async () => {
    const make = await http(ANDREA, "POST", "/api/requests", { type: "Leave of Absence Form", data: leave });
    assert.equal(make.status, 201); created.push(make.body.request.id); const id = make.body.request.id;

    // No signature yet: refused, and nothing changes.
    const refused = await http(TEMP, "POST", `/api/requests/${id}/approve`, {});
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /e-signature/i);
    assert.equal((await http(ANDREA, "GET", `/api/requests/${id}`)).body.request.steps[0].status, "Pending");

    // Returning or rejecting needs no signature, only approving does.
    const first = png("First signature");
    await http(TEMP, "PUT", "/api/signature", { imageData: first });
    assert.equal((await http(TEMP, "POST", `/api/requests/${id}/approve`, {})).status, 200);

    const signed = (await http(ANDREA, "GET", `/api/requests/${id}`)).body.request;
    assert.equal(signed.steps[0].signatureImage, first);
    assert.equal(signed.steps[0].signed, true);

    // The signer later draws a different signature. The document keeps the one it was signed with.
    await http(TEMP, "PUT", "/api/signature", { imageData: png("Second signature") });
    assert.equal((await http(ANDREA, "GET", `/api/requests/${id}`)).body.request.steps[0].signatureImage, first);
    await http(TEMP, "DELETE", "/api/signature");
    assert.equal((await http(ANDREA, "GET", `/api/requests/${id}`)).body.request.steps[0].signatureImage, first);
  });

  it("keeps images out of lists (they would be huge) but marks which steps are signed", async () => {
    const list = (await http(ANDREA, "GET", "/api/requests")).body.requests;
    const done = list.find((r: any) => r.id === "IIT-2025-1031");
    assert.deepEqual(done.steps.map((s: any) => s.signed), [true, true, true]);
    assert.ok(done.steps.every((s: any) => s.signatureImage === undefined));
    const detail = (await http(ANDREA, "GET", "/api/requests/IIT-2025-1031")).body.request;
    assert.ok(detail.steps.every((s: any) => /^data:image\/png;base64,/.test(s.signatureImage)));
  });

  it("puts the signature images on a permit, and discards them when the student resubmits", async () => {
    const permit = {
      term: "2nd Semester", schoolYear: "2024–2025", familyName: "Santos", givenName: "Andrea", middleName: "M.", studentId: "2021-1234", permitDate: "2025-05-26",
      college: "College of Computer Studies", department: "IT", courseYear: "BSIT – 4th Year",
      withdraw: [{ course: "IT 138", title: "Security", units: "3" }], add: [{ course: "IT 141", title: "Systems", units: "3", closed: false }],
      loadBeforeUnits: "18", loadBeforeHours: "21", loadAfterUnits: "18", loadAfterHours: "21", conflict: true, dissolved: false, otherReason: "", studentSignature: "Andrea M. Santos",
    };
    const make = await http(ANDREA, "POST", "/api/requests", { type: "Load Revision Form", data: permit });
    created.push(make.body.request.id); const id = make.body.request.id;
    await http(ADVISER, "POST", `/api/requests/${id}/approve`, {});
    const mid = (await http(ANDREA, "GET", `/api/requests/${id}`)).body.request;
    assert.deepEqual(Object.keys(mid.permit.signatureImages), ["Adviser"]);
    await http(CHAIR, "POST", `/api/requests/${id}/return`, { reason: "Please revise" });
    const re = await http(ANDREA, "PUT", `/api/requests/${id}`, { data: { ...permit, otherReason: "revised" } });
    assert.equal(re.status, 200);
    const fresh = (await http(ANDREA, "GET", `/api/requests/${id}`)).body.request;
    assert.deepEqual(fresh.permit.signatureImages, {});
    assert.ok(fresh.steps.every((s: any) => s.signed === false));
  });
});
