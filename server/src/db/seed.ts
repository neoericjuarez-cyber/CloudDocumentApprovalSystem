// DEV ONLY: wipes the tables and inserts demo accounts + sample submissions of all three forms in every state,
// so the whole system can be demonstrated. Every demo account uses the password "password123".
// Names are made up. The approvers get a generated signature image so signed documents look real.
import type pg from "pg";
import bcrypt from "bcryptjs";
import { env } from "../config/env";
import { pool, withTransaction } from "../lib/db";
import { buildSteps, type FormType, type Position, type StepStatus } from "../lib/workflow";
import { makeSignatureDataUrl } from "./demoSignature";

const PASSWORD = "password123";

type Student = { id: string; name: string; family: string; given: string; middle: string; studentNo: string };

const permit = (s: Student, over: object = {}) => ({
  term: "2nd Semester", schoolYear: "2024–2025", familyName: s.family, givenName: s.given, middleName: s.middle,
  studentId: s.studentNo, permitDate: "2025-05-22", college: "College of Computer Studies",
  department: "Information Technology Department", courseYear: "BS Information Technology – 4th Year",
  withdraw: [{ course: "IT 138 – A", title: "Information Assurance and Security", units: "3" }],
  add: [{ course: "IT 141 – B", title: "Systems Integration and Architecture", units: "3", closed: false }],
  loadBeforeUnits: "18", loadBeforeHours: "21", loadAfterUnits: "18", loadAfterHours: "21",
  conflict: true, dissolved: false, otherReason: "", studentSignature: s.name, ...over,
});

type SeedRequest = {
  ref: string; type: FormType; student: Student; created: string; data: object;
  // One entry per approval step: [status, when it was acted on, comment]
  steps: Array<[StepStatus, string | null, string | null]>;
};

async function insertRequest(db: pg.PoolClient, approvers: Record<Position, string>, signatures: Record<Position, string>, r: SeedRequest) {
  const stepRows = buildSteps(r.type);
  const stopped = r.steps.findIndex(([s]) => s === "Returned" || s === "Rejected");
  const pendingIdx = r.steps.findIndex(([s]) => s === "Pending");
  const status =
    stopped >= 0 ? (r.steps[stopped][0] === "Returned" ? "Returned for Revision" : "Rejected")
    : pendingIdx >= 0 ? "Pending" : "Completed";

  const id = (await db.query(
    `INSERT INTO requests (reference_no, type, student_id, status, current_step, return_reason, data, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id`,
    [r.ref, r.type, r.student.id, status, pendingIdx >= 0 ? pendingIdx + 1 : null,
     stopped >= 0 ? r.steps[stopped][2] : null, JSON.stringify(r.data), r.created])).rows[0].id as string;

  await db.query("INSERT INTO request_events (request_id, actor_id, action, created_at) VALUES ($1,$2,'submitted',$3)", [id, r.student.id, r.created]);
  for (const [i, [stepStatus, when, comment]] of r.steps.entries()) {
    const acted = stepStatus === "Approved" || stepStatus === "Returned" || stepStatus === "Rejected";
    const position = stepRows[i].position;
    await db.query(
      `INSERT INTO request_steps (request_id, step_order, position, status, acted_by, comment, acted_at, signature_image)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, i + 1, position, stepStatus, acted ? approvers[position] : null, acted ? comment : null, acted ? when : null,
       stepStatus === "Approved" ? signatures[position] : null]);
    if (acted)
      await db.query("INSERT INTO request_events (request_id, actor_id, action, comment, created_at) VALUES ($1,$2,$3,$4,$5)",
        [id, approvers[position], stepStatus === "Approved" ? "approved" : stepStatus === "Returned" ? "returned" : "rejected", comment, when]);
  }
  return id;
}

async function seed() {
  if (env.NODE_ENV === "production") throw new Error("Refusing to seed a production database.");
  const hash = await bcrypt.hash(PASSWORD, 10);

  await withTransaction(async db => {
    await db.query("TRUNCATE notifications, request_events, request_steps, signatures, requests, users RESTART IDENTITY CASCADE");

    const user = async (u: { email: string; name: string; role: string; position?: string; studentNo?: string }) =>
      (await db.query(
        `INSERT INTO users (email, password_hash, name, role, position, student_no, college, department)
         VALUES ($1,$2,$3,$4,$5,$6,'College of Computer Studies','Information Technology Department') RETURNING id`,
        [u.email, hash, u.name, u.role, u.position ?? null, u.studentNo ?? null])).rows[0].id as string;

    const student = async (email: string, name: string, family: string, given: string, middle: string, studentNo: string): Promise<Student> =>
      ({ id: await user({ email, name, role: "student", studentNo }), name, family, given, middle, studentNo });
    const andrea = await student("andrea.santos@g.msuiit.edu.ph", "Andrea M. Santos", "Santos", "Andrea", "M.", "2021-1234");
    const miguel = await student("miguel.ramos@g.msuiit.edu.ph", "Miguel T. Ramos", "Ramos", "Miguel", "T.", "2021-2210");
    const patricia = await student("patricia.cruz@g.msuiit.edu.ph", "Patricia N. Cruz", "Cruz", "Patricia", "N.", "2021-3302");
    const joel = await student("joel.dizon@g.msuiit.edu.ph", "Joel B. Dizon", "Dizon", "Joel", "B.", "2022-0415");

    const approverInfo: Array<[Position, string, string]> = [
      ["Adviser", "ramon.flores@msuiit.edu.ph", "Prof. Ramon C. Flores"],
      ["Chairperson", "maria.reyes@msuiit.edu.ph", "Dr. Maria L. Reyes"],
      ["College Dean", "jose.villanueva@msuiit.edu.ph", "Dr. Jose P. Villanueva"],
    ];
    const approvers = {} as Record<Position, string>;
    const signatures = {} as Record<Position, string>;
    for (const [position, email, name] of approverInfo) {
      approvers[position] = await user({ email, name, role: "approver", position });
      signatures[position] = makeSignatureDataUrl(name);
      await db.query("INSERT INTO signatures (user_id, image_data) VALUES ($1,$2)", [approvers[position], signatures[position]]);
    }

    const verified = "Academic load and prerequisites verified.";
    const ok = (when: string, comment: string | null = null): [StepStatus, string, string | null] => ["Approved", when, comment];
    const ids: Record<string, string> = {};
    const add = async (r: SeedRequest) => { ids[r.ref] = await insertRequest(db, approvers, signatures, r); };
    const leave = (reason: string) => ({ program: "BS Information Technology", yearLevel: "4th Year", academicYear: "2024–2025", semester: "Second semester", reason });
    const shift = (year: string, to: string, reason: string) => ({ program: "BS Information Technology", yearLevel: year, currentProgram: "BS Information Technology", intendedProgram: to, reason });

    // ---- Andrea: one of everything
    await add({ ref: "IIT-2025-0912", type: "Load Revision Form", student: andrea, created: "2025-04-22T09:00:00+08:00",
      data: permit(andrea, { term: "1st Semester", permitDate: "2025-04-22" }),
      steps: [ok("2025-04-23T10:00:00+08:00", verified), ok("2025-04-25T14:00:00+08:00"), ok("2025-04-29T11:00:00+08:00")] });
    await add({ ref: "IIT-2025-0987", type: "Shifter's Application Form", student: andrea, created: "2025-05-06T10:30:00+08:00",
      data: shift("3rd Year", "BS Computer Science", "I want to focus on software engineering and algorithms."),
      steps: [ok("2025-05-07T09:30:00+08:00", "Endorsed."), ["Returned", "2025-05-12T15:10:00+08:00", "Please attach your grade summary and state your target semester."], ["Waiting", null, null]] });
    await add({ ref: "IIT-2025-1031", type: "Leave of Absence Form", student: andrea, created: "2025-05-18T08:45:00+08:00",
      data: leave("Family relocation requires me to be away from Iligan for the semester."),
      steps: [ok("2025-05-19T10:00:00+08:00"), ok("2025-05-20T13:00:00+08:00"), ok("2025-05-22T09:00:00+08:00")] });
    await add({ ref: "IIT-2025-1048", type: "Load Revision Form", student: andrea, created: "2025-05-22T09:14:00+08:00", data: permit(andrea),
      steps: [ok("2025-05-23T14:36:00+08:00", verified), ["Pending", null, null], ["Waiting", null, null]] });

    // ---- Miguel
    await add({ ref: "IIT-2025-1056", type: "Leave of Absence Form", student: miguel, created: "2025-05-26T08:20:00+08:00",
      data: leave("Medical treatment requires a leave from classes this semester."),
      steps: [["Pending", null, null], ["Waiting", null, null], ["Waiting", null, null]] });
    await add({ ref: "IIT-2025-1059", type: "Shifter's Application Form", student: miguel, created: "2025-05-12T11:00:00+08:00",
      data: shift("2nd Year", "BS Computer Science", "My interests and strongest grades are in computing theory and mathematics."),
      steps: [ok("2025-05-13T09:00:00+08:00", "Grades support the shift."), ok("2025-05-15T10:30:00+08:00"), ok("2025-05-19T15:00:00+08:00")] });

    // ---- Patricia
    await add({ ref: "IIT-2025-1062", type: "Load Revision Form", student: patricia, created: "2025-05-14T09:30:00+08:00",
      data: permit(patricia, { permitDate: "2025-05-14", courseYear: "BS Information Technology – 3rd Year",
        withdraw: [{ course: "IT 133 – A", title: "Networking 2", units: "3" }, { course: "IT 135 – C", title: "Web Systems", units: "3" }],
        add: [{ course: "IT 142 – A", title: "Capstone Project 1", units: "3", closed: true }],
        loadBeforeUnits: "24", loadBeforeHours: "27", loadAfterUnits: "21", loadAfterHours: "24",
        conflict: false, dissolved: true, otherReason: "Capstone adviser approved the closed section." }),
      steps: [ok("2025-05-15T10:00:00+08:00", verified), ok("2025-05-16T14:20:00+08:00"), ok("2025-05-20T09:40:00+08:00")] });
    await add({ ref: "IIT-2025-1066", type: "Leave of Absence Form", student: patricia, created: "2025-05-20T08:10:00+08:00",
      data: leave("I will attend an overseas exchange program next semester."),
      steps: [ok("2025-05-21T10:00:00+08:00"), ok("2025-05-23T11:30:00+08:00"), ["Pending", null, null]] });
    await add({ ref: "IIT-2025-1068", type: "Shifter's Application Form", student: patricia, created: "2025-05-24T13:15:00+08:00",
      data: shift("2nd Year", "BS Information Systems", "I am more interested in business information management."),
      steps: [ok("2025-05-25T09:45:00+08:00"), ["Pending", null, null], ["Waiting", null, null]] });

    // ---- Joel
    await add({ ref: "IIT-2025-1070", type: "Load Revision Form", student: joel, created: "2025-05-21T10:05:00+08:00",
      data: permit(joel, { permitDate: "2025-05-21", courseYear: "BS Information Technology – 2nd Year", loadAfterUnits: "24", loadAfterHours: "27" }),
      steps: [["Returned", "2025-05-22T11:40:00+08:00", "The total load after revision exceeds the 21-unit limit. Please recompute and resubmit."], ["Waiting", null, null], ["Waiting", null, null]] });
    await add({ ref: "IIT-2025-1077", type: "Shifter's Application Form", student: joel, created: "2025-05-27T09:00:00+08:00",
      data: shift("1st Year", "BS Computer Science", "I realized I prefer programming and mathematics over networking."),
      steps: [["Pending", null, null], ["Waiting", null, null], ["Waiting", null, null]] });
    await add({ ref: "IIT-2025-1080", type: "Leave of Absence Form", student: joel, created: "2025-05-15T14:00:00+08:00",
      data: leave("Personal matters. I would like to be on leave for one year."),
      steps: [ok("2025-05-16T10:20:00+08:00"), ["Rejected", "2025-05-19T16:00:00+08:00", "The requested leave exceeds the maximum allowable period of two semesters."], ["Waiting", null, null]] });

    const note = (userId: string, ref: string, kind: string, title: string, message: string, at: string, read: boolean) =>
      db.query("INSERT INTO notifications (user_id, request_id, kind, title, message, read, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [userId, ids[ref], kind, title, message, read, at]);
    await note(andrea.id, "IIT-2025-1048", "check", "Approved by Adviser", "IIT-2025-1048 was approved by Prof. Ramon C. Flores and is now with the Chairperson.", "2025-05-23T14:36:00+08:00", false);
    await note(andrea.id, "IIT-2025-0987", "rotate", "Revision requested", "IIT-2025-0987 was returned by the Chairperson: Please attach your grade summary and state your target semester.", "2025-05-12T15:10:00+08:00", false);
    await note(andrea.id, "IIT-2025-1031", "check", "Your document was approved", "IIT-2025-1031 has received final approval.", "2025-05-22T09:00:00+08:00", true);
    await note(miguel.id, "IIT-2025-1059", "check", "Your document was approved", "IIT-2025-1059 has received final approval.", "2025-05-19T15:00:00+08:00", true);
    await note(joel.id, "IIT-2025-1070", "rotate", "Revision requested", "IIT-2025-1070 was returned by the Adviser: The total load after revision exceeds the 21-unit limit. Please recompute and resubmit.", "2025-05-22T11:40:00+08:00", false);
    await note(joel.id, "IIT-2025-1080", "x", "Request rejected", "IIT-2025-1080 was rejected by the Chairperson: The requested leave exceeds the maximum allowable period of two semesters.", "2025-05-19T16:00:00+08:00", false);
    await note(approvers.Adviser, "IIT-2025-1056", "file", "New document awaiting review", "Miguel T. Ramos submitted a Leave of Absence Form (IIT-2025-1056).", "2025-05-26T08:20:00+08:00", false);
    await note(approvers.Adviser, "IIT-2025-1077", "file", "New document awaiting review", "Joel B. Dizon submitted a Shifter's Application Form (IIT-2025-1077).", "2025-05-27T09:00:00+08:00", false);
    await note(approvers.Chairperson, "IIT-2025-1048", "file", "New document awaiting review", "Andrea M. Santos's Load Revision Form (IIT-2025-1048) was approved by the Adviser.", "2025-05-23T14:36:00+08:00", false);
    await note(approvers.Chairperson, "IIT-2025-1068", "file", "New document awaiting review", "Patricia N. Cruz's Shifter's Application Form (IIT-2025-1068) was approved by the Adviser.", "2025-05-25T09:45:00+08:00", false);
    await note(approvers["College Dean"], "IIT-2025-1066", "file", "New document awaiting review", "Patricia N. Cruz's Leave of Absence Form (IIT-2025-1066) was approved by the Chairperson.", "2025-05-23T11:30:00+08:00", false);

    await db.query("SELECT setval('request_ref_seq', 1080)");   // the next new request gets 1081
  });

  console.log(`Seeded 4 students, 3 approvers (with signatures) and 12 sample requests. Log in with any seeded email and password "${PASSWORD}".`);
}

seed()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
