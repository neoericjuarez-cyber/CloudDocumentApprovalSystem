// Live SQL-injection attacks against the real API and database. Needs the seeded database.
// Each attack must (a) fail to get in or read anything, and (b) leave every table and row untouched.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

process.env.LOGIN_RATE_LIMIT_MAX = "100000";
const { createApp } = await import("../src/app");
const { pool, query } = await import("../src/lib/db");

const PASSWORD = "password123";
const ANDREA = "andrea.santos@g.msuiit.edu.ph", MIGUEL = "miguel.ramos@g.msuiit.edu.ph", ADVISER = "ramon.flores@msuiit.edu.ph", CHAIR = "maria.reyes@msuiit.edu.ph";

let base = "";
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;
const tokens: Record<string, string> = {};
const created: string[] = [];

async function http(who: string | null, method: string, path: string, body?: unknown, rawBody?: string) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined || rawBody ? { "Content-Type": "application/json" } : {}), ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}) },
    body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const login = (email: string, password: string) => http(null, "POST", "/api/auth/login", { email, password });

/**
 * Everything an injection could damage: the table list, user/signature counts, every password hash, and every SEEDED
 * request (reference numbers up to 1080) with its notifications. Requests these tests create are excluded.
 */
async function fingerprint() {
  const tables = (await query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1")).rows.map(r => r.table_name);
  const counts = {
    users: (await query("SELECT count(*)::int n FROM users")).rows[0].n,
    signatures: (await query("SELECT count(*)::int n FROM signatures")).rows[0].n,
    seededNotifications: (await query("SELECT count(*)::int n FROM notifications n JOIN requests r ON r.id = n.request_id WHERE split_part(r.reference_no, '-', 3)::int <= 1080")).rows[0].n,
  };
  const statuses = (await query("SELECT reference_no, status, current_step FROM requests WHERE split_part(reference_no, '-', 3)::int <= 1080 ORDER BY 1")).rows;
  const passwords = (await query("SELECT email, password_hash FROM users ORDER BY 1")).rows;
  return { tables, counts, statuses, passwords };
}

let before_: Awaited<ReturnType<typeof fingerprint>>;

before(async () => {
  assert.ok((await query("SELECT 1 FROM users WHERE email = $1", [ANDREA])).rowCount, "Not seeded. Run: npm run db:migrate && npm run db:seed");
  server = createApp().listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  for (const email of [ANDREA, MIGUEL, ADVISER, CHAIR]) tokens[email] = (await login(email, PASSWORD)).body.token;
  before_ = await fingerprint();
});

after(async () => {
  if (created.length) await query("DELETE FROM requests WHERE reference_no = ANY($1)", [created]);
  server.close();
  await pool.end();
});

describe("login", () => {
  const classicPayloads = ["' OR '1'='1", "' OR 1=1 --", "'; DROP TABLE users; --", "\" OR \"\"=\"", "admin'--", "' UNION SELECT id, password_hash FROM users --", "1; UPDATE users SET password_hash='x'"];

  it("is not fooled by injection in the password", async () => {
    for (const p of classicPayloads) {
      const r = await login(ANDREA, p);
      assert.equal(r.status, 401, `password ${p}`);
      assert.equal(r.body.token, undefined);
    }
  });

  it("is not fooled by injection in the email (valid-looking addresses reach the database as plain data)", async () => {
    const emails = ["admin'--@msuiit.edu.ph", "x'OR'1'='1@msuiit.edu.ph", "a'||'b@msuiit.edu.ph", "andrea.santos@g.msuiit.edu.ph' OR '1'='1", "' OR 1=1 --", "x@y.z'; DROP TABLE users;--"];
    for (const e of emails) {
      for (const p of [PASSWORD, "' OR '1'='1"]) {
        const r = await login(e, p);
        assert.ok([400, 401].includes(r.status), `${e} / ${p} -> ${r.status}`);
        assert.equal(r.body.token, undefined, `${e} must not produce a token`);
      }
    }
  });

  it("can't be made to sleep (time-based injection)", async () => {
    for (const email of ["x'||pg_sleep(4)||'@msuiit.edu.ph", "x';SELECT pg_sleep(4);--@msuiit.edu.ph"]) {
      const started = Date.now();
      const r = await login(email, "whatever");
      assert.ok(Date.now() - started < 2500, "took long enough that pg_sleep may have run");
      assert.ok([400, 401].includes(r.status), `status ${r.status}`);
    }
  });

  it("rejects objects and arrays where text is expected (the 'NoSQL-style' trick)", async () => {
    for (const body of [{ email: { $ne: null }, password: { $ne: null } }, { email: [ANDREA], password: PASSWORD }, { email: ANDREA, password: ["a"] }, { email: null, password: null }]) {
      assert.equal((await http(null, "POST", "/api/auth/login", body)).status, 400);
    }
  });
});

describe("addresses in URLs", () => {
  const evil = ["IIT-2025-1048' OR '1'='1", "IIT-2025-1048; DROP TABLE requests; --", "IIT-2025-1048' UNION SELECT * FROM users --", "' OR 1=1 --", "IIT-2025-1048%27", "1 OR 1=1", "IIT-2025-1048/../../etc/passwd"];

  it("answers 404 and reveals nothing, on every request route", async () => {
    for (const ref of evil) {
      const p = encodeURIComponent(ref);
      for (const [method, path] of [["GET", `/api/requests/${p}`], ["GET", `/api/requests/${p}/pdf`], ["POST", `/api/requests/${p}/approve`], ["POST", `/api/requests/${p}/return`], ["POST", `/api/requests/${p}/reject`]] as const) {
        const who = method === "GET" ? ANDREA : ADVISER;
        const r = await http(who, method, path, method === "POST" ? { reason: "x", comment: "x" } : undefined);
        assert.equal(r.status, 404, `${method} ${path}`);
      }
      assert.equal((await http(ANDREA, "PUT", `/api/requests/${p}`, { data: {} })).status, 404);
    }
  });

  it("notification ids can't carry SQL either", async () => {
    for (const id of ["1' OR '1'='1", "1; DROP TABLE notifications;--", "00000000-0000-0000-0000-000000000000' OR '1'='1"]) {
      assert.equal((await http(ANDREA, "POST", `/api/notifications/${encodeURIComponent(id)}/read`)).status, 404);
    }
  });

  it("an injected address can't be used to read someone else's request", async () => {
    const r = await http(MIGUEL, "GET", `/api/requests/${encodeURIComponent("IIT-2025-1031' OR '1'='1")}`);   // 1031 is Andrea's
    assert.equal(r.status, 404);
    const list = (await http(MIGUEL, "GET", "/api/requests")).body.requests;
    assert.ok(list.every((x: any) => x.student === "Miguel T. Ramos"));
  });
});

describe("hostile text saved in forms stays plain text", () => {
  const nasty = {
    reason: "'); DROP TABLE requests; --",
    semester: "x' OR '1'='1",
    "a'); DROP TABLE users; --": "key injection",
    note: "Robert'); UPDATE requests SET status='Completed'; --",
    unicode: "Zoë 😀 日本語 <script>alert(1)</script> \\ \" %s $1 ${x}",
  };

  it("is stored exactly as typed and returned unchanged", async () => {
    const make = await http(ANDREA, "POST", "/api/requests", { type: "Leave of Absence Form", data: nasty });
    assert.equal(make.status, 201, JSON.stringify(make.body));
    created.push(make.body.request.id);
    const back = await http(ANDREA, "GET", `/api/requests/${make.body.request.id}`);
    assert.deepEqual(back.body.request.details, nasty);
    const row = (await query("SELECT data FROM requests WHERE reference_no = $1", [make.body.request.id])).rows[0];
    assert.deepEqual(row.data, nasty);
  });

  it("works in the permit's text fields too", async () => {
    const permit = {
      term: "2nd Semester", schoolYear: "2024–2025", familyName: "O'Brien", givenName: "Robert'); DROP TABLE users;--", middleName: "", studentId: "x", permitDate: "2025-05-26",
      college: "College of Computer Studies", department: "IT", courseYear: "BSIT – 4th Year",
      withdraw: [{ course: "IT' OR '1'='1", title: "'; DELETE FROM requests; --", units: "3" }],
      add: [{ course: "IT 141", title: "Systems", units: "3", closed: false }],
      loadBeforeUnits: "18", loadBeforeHours: "21", loadAfterUnits: "18", loadAfterHours: "21",
      conflict: true, dissolved: false, otherReason: "Bobby Tables: '); DROP TABLE requests;--", studentSignature: "Andrea M. Santos",
    };
    const make = await http(ANDREA, "POST", "/api/requests", { type: "Load Revision Form", data: permit });
    assert.equal(make.status, 201, JSON.stringify(make.body));
    created.push(make.body.request.id);
    const back = (await http(ANDREA, "GET", `/api/requests/${make.body.request.id}`)).body.request.permit;
    assert.equal(back.givenName, permit.givenName);
    assert.equal(back.withdraw[0].title, "'; DELETE FROM requests; --");
    assert.equal(back.otherReason, permit.otherReason);
  });

  it("approval comments and return reasons are stored as text and change nothing else", async () => {
    const make = await http(ANDREA, "POST", "/api/requests", { type: "Leave of Absence Form", data: { reason: "ok" } });
    created.push(make.body.request.id);
    const id = make.body.request.id;
    const approve = await http(ADVISER, "POST", `/api/requests/${id}/approve`, { comment: "'); UPDATE requests SET status='Completed'; --" });
    assert.equal(approve.status, 200);
    const returned = await http(CHAIR, "POST", `/api/requests/${id}/return`, { reason: "x'; UPDATE users SET role='approver'; --" });
    assert.equal(returned.status, 200);
    const detail = (await http(ANDREA, "GET", `/api/requests/${id}`)).body.request;
    assert.equal(detail.status, "Returned for Revision");
    assert.equal(detail.reason, "x'; UPDATE users SET role='approver'; --");
    assert.equal(detail.events.find((e: any) => e.action === "approved").comment, "'); UPDATE requests SET status='Completed'; --");
  });

  it("odd types are refused, not interpreted", async () => {
    for (const type of ["Leave of Absence Form'; DROP TABLE requests;--", ["Leave of Absence Form"], { $ne: 1 }, 7, null]) {
      assert.equal((await http(ANDREA, "POST", "/api/requests", { type, data: { reason: "x" } })).status, 400);
    }
  });
});

describe("afterwards", () => {
  it("every table, row count, password and seeded request is exactly as before", async () => {
    const after_ = await fingerprint();
    assert.deepEqual(after_.tables, before_.tables, "a table was added or dropped");
    assert.deepEqual(after_.counts, before_.counts, "rows were added or removed");
    assert.deepEqual(after_.passwords, before_.passwords, "a password changed");
    assert.deepEqual(after_.statuses, before_.statuses, "a seeded request changed");
  });
});
