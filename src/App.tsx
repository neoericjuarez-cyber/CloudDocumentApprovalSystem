import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { Role, Page, Status, SubjectRow, LoadRevisionPermit, RequestItem, AppNotification } from "@/types";
import { defaultPermit } from "@/mocks/seed";
import { permitTemplate } from "@/lib/permit";
import { requestFacts, eventTitle, eventText } from "@/lib/requestFacts";
import { exportRequestsCsv } from "@/lib/csv";
import { openMail } from "@/lib/download";
import { getSignature, type SavedSignature } from "@/api/signature";
import { SignaturePage } from "@/features/signature/SignaturePage";
import { canonicalType, isLoadRevision } from "@/lib/requestTypes";
import { Icon, Button, StatusBadge, Logo, Field, Modal } from "@/components/ui";
import { ApiError, errorMessage } from "@/api/client";
import { createRequest, decideRequest, downloadRequestPdf, getRequest, listNotifications, listRequests, markAllNotificationsRead, markNotificationRead, resubmitRequest } from "@/api/requests";
import { useAuth, useCurrentUser } from "@/context/AuthContext";
import { formatDateTime, greetingName, initials, stripTitle, timeAgo, todayLabel } from "@/lib/format";

const studentNav = [
  ["dashboard", "grid", "Dashboard"],
  ["new", "plus", "New Request"],
  ["requests", "file", "My Requests"],
  ["notifications", "bell", "Notifications"],
  ["settings", "settings", "Profile & Settings"],
];
const approverNav = [
  ["dashboard", "grid", "Dashboard"],
  ["requests", "clock", "Pending Approvals"],
  ["requests", "file", "Processed Requests"],
  ["signature", "pen", "My E-Signature"],
  ["notifications", "bell", "Notifications"],
  ["settings", "settings", "Profile & Settings"],
];

function Sidebar({ role, page, navigate, open, close }: { role: Role; page: Page; navigate: (p: Page) => void; open: boolean; close: () => void }) {
  const { logout } = useAuth();
  const nav = role === "student" ? studentNav : approverNav;
  return <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
    <div className="sidebar-head"><Logo light/><button className="mobile-close" onClick={close} aria-label="Close menu"><Icon name="x"/></button></div>
    <div className="role-label">{role === "student" ? "Student Portal" : "Approver Workspace"}</div>
    <nav>{nav.map(([target, icon, label], i) => <button key={`${label}-${i}`} className={(page === target && !(i === 2 && role === "approver")) ? "nav-active" : ""} onClick={() => { navigate(target as Page); close(); }}><Icon name={icon}/><span>{label}</span>{label === "Notifications" && <em>3</em>}</button>)}</nav>
    <div className="sidebar-support"><div className="support-icon">?</div><strong>Need help?</strong><p>Visit the service guide or contact ICTC support.</p><button>View support center <Icon name="arrow" size={14}/></button></div>
    <button className="signout" onClick={logout}><Icon name="logout"/><span>Sign out</span></button>
  </aside>;
}

function Shell({ children, role, page, navigate, title, subtitle, unread = 0 }: { children: ReactNode; role: Role; page: Page; navigate: (p: Page) => void; title: string; subtitle: string; unread?: number }) {
  const user = useCurrentUser();
  const [menu, setMenu] = useState(false);
  return <div className="app-shell">
    <Sidebar role={role} page={page} navigate={navigate} open={menu} close={() => setMenu(false)}/>
    {menu && <div className="scrim" onClick={() => setMenu(false)}/>}
    <main className="main">
      <header className="topbar">
        <button className="menu-btn" onClick={() => setMenu(true)} aria-label="Open menu"><Icon name="menu"/></button>
        <div className="page-heading"><h1>{title}</h1><p>{subtitle}</p></div>
        <div className="top-actions">
          <button className="icon-btn" onClick={() => navigate("notifications")} aria-label="Notifications"><Icon name="bell"/>{unread > 0 && <i/>}</button>
          <div className="profile"><div className="avatar">{initials(user.name)}</div><div><strong>{user.name}</strong><small>{user.role === "student" ? (user.department ?? "Student") : user.position}</small></div><Icon name="chevron" size={15}/></div>
        </div>
      </header>
      <div className="content">{children}</div>
    </main>
  </div>;
}

function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) { setError("Enter your university email and password."); return; }
    setBusy(true); setError("");
    try { await login(email.trim(), password); }   // on success App re-renders and this screen goes away
    catch (err) { setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again."); setBusy(false); }
  }
  return <div className="login-page">
    <section className="login-story">
      <div className="story-overlay"/>
      <div className="story-content"><Logo light/><div className="story-copy"><span className="eyebrow light">A better way to move documents forward</span><h1>Approvals, made simpler.</h1><p>Submit university documents, follow every approval, and keep your academic requests moving—wherever you are.</p><div className="trust-row"><span><Icon name="check" size={16}/> Transparent tracking</span><span><Icon name="check" size={16}/> Secure e-signatures</span></div></div><small className="copyright">© 2025 Mindanao State University – Iligan Institute of Technology</small></div>
    </section>
    <section className="login-panel">
      <div className="login-box">
        <div className="mobile-logo"><Logo/></div>
        <span className="eyebrow">Welcome to Document Services</span>
        <h2>Sign in to your account</h2><p className="muted">Use your official MSU-IIT university credentials.</p>
        <form onSubmit={submit}>
          <label>University email</label>
          <div className={`field-icon ${error ? "field-error" : ""}`}><Icon name="mail" size={18}/><input type="email" value={email} onChange={e => {setEmail(e.target.value); setError("")}} placeholder="name@g.msuiit.edu.ph"/></div>
          {error && <div className="error-text">{error}</div>}
          <div className="label-row"><label>Password</label><button type="button" onClick={() => setInfo(true)}>Forgot password?</button></div>
          <div className="field-icon"><Icon name="user" size={18}/><input type={show ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password"/><button type="button" className="show-pass" onClick={() => setShow(!show)}><Icon name="eye" size={18}/></button></div>
          {info && <div className="error-text" style={{ color: "#536d84" }}>Password resets are handled by your department administrator. Please contact them to have your password reset.</div>}<Button type="submit" className="full" disabled={busy}>{busy ? "Signing in…" : <>Sign in <Icon name="arrow" size={17}/></>}</Button>
        </form>
        {import.meta.env.DEV && <>
          <div className="divider"><span>Demo accounts (dev only)</span></div>
          <div className="demo-buttons"><Button variant="secondary" onClick={() => {setEmail("andrea.santos@g.msuiit.edu.ph"); setPassword("password123"); setError("")}}><Icon name="user" size={17}/> Fill Student</Button><Button variant="secondary" onClick={() => {setEmail("maria.reyes@msuiit.edu.ph"); setPassword("password123"); setError("")}}><Icon name="file" size={17}/> Fill Approver</Button></div>
        </>}
        <p className="privacy">By signing in, you agree to the university's acceptable use and data privacy policies.</p>
      </div>
    </section>
  </div>;
}

function StatCard({ label, value, icon, tone, trend }: { label: string; value: number; icon: string; tone: string; trend?: string }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon name={icon}/></div><div><p>{label}</p><strong>{value}</strong>{trend && <small>{trend}</small>}</div></div>;
}

function RequestTable({ data, onOpen, approver = false }: { data: RequestItem[]; onOpen: (r: RequestItem) => void; approver?: boolean }) {
  if (data.length === 0) return <div className="empty"><Icon name="file" size={28}/><h3>No requests yet</h3><p>Documents will appear here as soon as they are submitted.</p></div>;
  return <div className="table-wrap"><table><thead><tr><th>Reference</th>{approver && <th>Student</th>}<th>Document type</th><th>Submitted</th><th>Current stage</th><th>Status</th><th><span className="sr-only">Action</span></th></tr></thead>
  <tbody>{data.map((r, index) => <tr key={`${r.id}-${r.type}-${r.date}-${index}`} onClick={() => onOpen(r)}><td><strong className="ref">{r.id}</strong></td>{approver && <td><div className="student-cell"><span>{r.student.split(" ").map(x => x[0]).slice(0,2).join("")}</span><strong>{r.student}</strong></div></td>}<td><div className="doc-cell"><span><Icon name="file" size={17}/></span>{r.type}</div></td><td>{r.date}</td><td>{approver && r.status === "Pending" ? <span className="priority"><i/>Awaiting review</span> : r.stage}</td><td><StatusBadge status={r.status}/></td><td><button className="row-action" aria-label="View request"><Icon name="chevron" size={17}/></button></td></tr>)}</tbody></table></div>;
}

function StudentDashboard({ navigate, open, requests }: { navigate: (p: Page) => void; open: (r: RequestItem) => void; requests: RequestItem[] }) {
  const user = useCurrentUser();
  const pending = requests.filter(r => r.status === "Pending");
  const completed = requests.filter(r => r.status === "Completed");
  const stopped = requests.filter(r => r.status === "Returned for Revision" || r.status === "Rejected");
  const active = pending[0];
  return <>
    <div className="welcome-row"><div><span className="eyebrow">{todayLabel()}</span><h2>Good morning, {greetingName(user)}.</h2><p>{pending.length === 0 ? "You have no documents waiting for approval." : `You have ${pending.length} document${pending.length === 1 ? "" : "s"} currently waiting for approval.`}</p></div><Button icon="plus" onClick={() => navigate("new")}>New document request</Button></div>
    <div className="stats-grid"><StatCard label="Total requests" value={requests.length} icon="file" tone="tone-maroon"/><StatCard label="Pending" value={pending.length} icon="clock" tone="tone-amber"/><StatCard label="Completed" value={completed.length} icon="check" tone="tone-green"/><StatCard label="Returned / Rejected" value={stopped.length} icon="rotate" tone="tone-red"/></div>
    <div className="dashboard-grid">
      <section className="card table-card"><div className="card-head"><div><h3>Recent document requests</h3><p>Your latest submissions and their current progress.</p></div><Button variant="ghost" onClick={() => navigate("requests")}>View all <Icon name="arrow" size={15}/></Button></div><RequestTable data={requests.slice(0, 4)} onOpen={open}/></section>
      <aside className="card progress-card">{active ? <>
        <div className="card-head"><div><h3>Active request</h3><p>{active.id}</p></div><StatusBadge status={active.status}/></div>
        <div className="active-document"><div className="doc-big"><Icon name="file"/></div><div><strong>{active.type}</strong><span>Submitted {active.date}</span></div></div>
        <div className="mini-timeline"><StepsTimeline request={active}/></div>
        <Button variant="secondary" className="full" onClick={() => open(active)}>Track request</Button>
      </> : <>
        <div className="card-head"><div><h3>Active request</h3><p>Nothing in progress</p></div></div>
        <small className="timeline-note">When you submit a document, you can follow every approval step here.</small>
      </>}</aside>
    </div>
  </>;
}

/** Submitted → Adviser → Chairperson → College Dean → Completed, built from the request's real steps. */
function StepsTimeline({ request }: { request: RequestItem }) {
  const allDone = request.steps.length > 0 && request.steps.every(s => s.status === "Approved");
  const meta = (s: RequestItem["steps"][number]) =>
    s.status === "Approved" ? (s.actorName ?? "Approved")
    : s.status === "Pending" ? "Awaiting review"
    : s.status === "Waiting" ? "Waiting for earlier approvals"
    : `${s.status} by ${s.actorName ?? "approver"}`;
  return <>
    <Step done label="Submitted" meta={request.student}/>
    {request.steps.map(s => <Step key={s.order} done={s.status === "Approved"} current={s.status === "Pending"} label={s.position} meta={meta(s)}/>)}
    <Step done={allDone} label="Completed" meta={allDone ? "Final approval granted" : "Final stage"}/>
  </>;
}

/** The signature that will be stamped on the document, or a way to create one. */
function SignaturePreview({ signature, goSignature }: { signature: string | null; goSignature: () => void }) {
  return signature
    ? <div className="preview-sign" style={{ height: 110 }}><img src={signature} alt="Your signature" style={{ maxWidth: "90%", maxHeight: 90 }}/></div>
    : <div className="error-text">You haven't saved an e-signature yet, so you can't approve. <Button variant="secondary" onClick={goSignature}>Create my e-signature</Button></div>;
}

function HistoryList({ request }: { request: RequestItem }) {
  if (!request.events) return <p className="small">Loading history…</p>;
  return <div className="review-section"><h3>Status history</h3>{request.events.map((e, i) => <div className="history-item" key={i}><span className={`avatar tiny ${e.action === "submitted" || e.action === "resubmitted" ? "" : "dark"}`}>{initials(e.actorName ?? "?")}</span><div><strong>{eventTitle(e)}</strong><p>{eventText(e, request)}</p><small>{formatDateTime(e.at)}</small></div></div>)}</div>;
}

const contactStudent = (r: RequestItem) => openMail(r.studentEmail ?? "", `${r.id} – ${r.type}`);

function Step({ label, meta, done, current }: { label: string; meta: string; done?: boolean; current?: boolean }) {
  return <div className={`step ${done ? "step-done" : ""} ${current ? "step-current" : ""}`}><div className="step-mark">{done ? <Icon name="check" size={13}/> : <span/>}</div><div><strong>{label}</strong><small>{meta}</small></div>{current && <em>Current</em>}</div>;
}

const formTypes = [
  { title: "Academic Load Revision Permit", desc: "Official permit to add or withdraw subjects and revise your academic load.", meta: "FM-MSU-IIT-RGTR-008", accent: "maroon" },
  { title: "Shifter's Application Form", desc: "Apply to shift or transfer from your current program to an intended program.", meta: "Program change", accent: "blue" },
  { title: "Leave of Absence Form", desc: "Request an approved temporary leave from your academic program.", meta: "Academic leave", accent: "amber" },
];

function NewRequest({ select }: { select: (type: string) => void }) {
  return <><div className="intro"><span className="eyebrow">Start a request</span><h2>Which document do you need?</h2><p>Select a university form to begin. You can review all information before submitting.</p></div><div className="form-cards">{formTypes.map((f, i) => <article className="form-card" key={f.title}><div className={`form-illustration ${f.accent}`}><Icon name={i === 2 ? "clock" : i === 1 ? "rotate" : "file"} size={28}/><span>{String(i + 1).padStart(2, "0")}</span></div><small>{f.meta}</small><h3>{f.title}</h3><p>{f.desc}</p><Button variant="secondary" onClick={() => select(f.title)}>Start request <Icon name="arrow" size={16}/></Button></article>)}</div><div className="info-banner"><div><Icon name="check"/></div><p><strong>Your progress is protected.</strong><span>All submitted information is used only for university document processing. You can cancel before final submission.</span></p></div></>;
}

function SubjectEditor({ kind, rows, update }: { kind: "withdraw" | "add"; rows: SubjectRow[]; update: (rows: SubjectRow[]) => void }) {
  const change = (index: number, field: keyof SubjectRow, value: string | boolean) => update(rows.map((row, i) => i === index ? { ...row, [field]: value } : row));
  return <div className="subject-editor">
    <div className="subject-editor-head"><div><h4>{kind === "withdraw" ? "Withdraw subjects" : "Add subjects"}</h4><p>{kind === "withdraw" ? "Controller and professor signatures are completed by authorized personnel." : "Controller and closed-subject instructor approvals are completed by authorized personnel."}</p></div><Button variant="secondary" icon="plus" onClick={() => update([...rows, { course: "", title: "", units: "", closed: false }])}>Add row</Button></div>
    {rows.map((row, index) => <div className="subject-row" key={`${kind}-${index}`}>
      <div className="subject-row-number">{index + 1}</div>
      <div className="subject-fields">
        <Field label="Course number and section" required><input value={row.course} onChange={e => change(index, "course", e.target.value)} placeholder="e.g. IT 141 – A"/></Field>
        <Field label="Course title" required><input value={row.title} onChange={e => change(index, "title", e.target.value)} placeholder="Official course title"/></Field>
        <Field label="Units" required><input type="number" min="0" value={row.units} onChange={e => change(index, "units", e.target.value)} placeholder="3"/></Field>
        {kind === "add" && <label className="check-field"><input type="checkbox" checked={!!row.closed} onChange={e => change(index, "closed", e.target.checked)}/><span>Closed subject</span></label>}
      </div>
      <div className="readonly-signatures">
        <span><Icon name="pen" size={14}/> Controller signature <b>University personnel only</b></span>
        <span><Icon name="pen" size={14}/> {kind === "withdraw" ? "Professor signature" : "Instructor approval for closed subject"} <b>{kind === "add" && !row.closed ? "Not applicable" : "University personnel only"}</b></span>
      </div>
      {rows.length > 1 && <button className="remove-row" type="button" onClick={() => update(rows.filter((_, i) => i !== index))}><Icon name="x" size={14}/> Remove</button>}
    </div>)}
  </div>;
}

function LoadRevisionForm({ cancel, submit, initial }: { cancel: () => void; submit: (permit: LoadRevisionPermit) => Promise<void>; initial?: LoadRevisionPermit }) {
  const user = useCurrentUser();
  const [data, setData] = useState<LoadRevisionPermit>(() => initial ?? permitTemplate(user));
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const set = <K extends keyof LoadRevisionPermit,>(field: K, value: LoadRevisionPermit[K]) => setData(current => ({ ...current, [field]: value }));
  function validate(e: FormEvent) {
    e.preventDefault();
    const required = [data.schoolYear, data.familyName, data.givenName, data.studentId, data.permitDate, data.college, data.department, data.courseYear, data.loadBeforeUnits, data.loadBeforeHours, data.loadAfterUnits, data.loadAfterHours, data.studentSignature];
    const invalidRows = [...data.withdraw, ...data.add].some(row => !row.course.trim() || !row.title.trim() || !row.units.trim());
    if (required.some(value => !value.trim()) || invalidRows || (!data.conflict && !data.dissolved && !data.otherReason.trim())) {
      setError("Complete all required fields and select or enter at least one reason for revision.");
      return;
    }
    setError("");
    setConfirm(true);
  }
  async function confirmSubmit() {
    setBusy(true);
    try { await submit(data); }
    catch (e) { setConfirm(false); setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <><div className="form-page-head"><button className="back-link" onClick={cancel}>← Back to forms</button><span>Official Registrar Form · FM-MSU-IIT-RGTR-008</span><h2>Academic Load Revision Permit</h2><p>Complete the student portions of the official permit. Signature fields for university personnel are read-only.</p></div>
    <form className="request-form permit-form" onSubmit={validate}>
      <section className="form-section"><div className="section-number">1</div><div className="section-body"><div className="section-title"><h3>Academic term</h3><p>Select the term covered by this permit.</p></div><div className="form-grid"><Field label="Academic term" required><select value={data.term} onChange={e => set("term", e.target.value as LoadRevisionPermit["term"])}><option>1st Semester</option><option>2nd Semester</option><option>Summer Term</option></select></Field><Field label="School year" required><input value={data.schoolYear} onChange={e => set("schoolYear", e.target.value)} placeholder="e.g. 2025–2026"/></Field></div></div></section>
      <section className="form-section"><div className="section-number">2</div><div className="section-body"><div className="section-title"><h3>Student information</h3><p>Enter your name in Family, Given, Middle order as shown on the permit.</p></div><div className="form-grid three-col"><Field label="Family name" required><input value={data.familyName} onChange={e => set("familyName", e.target.value)}/></Field><Field label="Given name" required><input value={data.givenName} onChange={e => set("givenName", e.target.value)}/></Field><Field label="Middle name"><input value={data.middleName} onChange={e => set("middleName", e.target.value)}/></Field><Field label="Student ID number" required><input value={data.studentId} onChange={e => set("studentId", e.target.value)}/></Field><Field label="Date" required><input type="date" value={data.permitDate} onChange={e => set("permitDate", e.target.value)}/></Field></div></div></section>
      <section className="form-section"><div className="section-number">3</div><div className="section-body"><div className="section-title"><h3>Academic information</h3><p>Provide your current college, department, course, and year.</p></div><div className="form-grid"><Field label="College / School" required><input value={data.college} onChange={e => set("college", e.target.value)}/></Field><Field label="Department" required><input value={data.department} onChange={e => set("department", e.target.value)}/></Field><Field label="Course and year" required><input value={data.courseYear} onChange={e => set("courseYear", e.target.value)}/></Field></div></div></section>
      <section className="form-section"><div className="section-number">4</div><div className="section-body"><SubjectEditor kind="withdraw" rows={data.withdraw} update={rows => set("withdraw", rows)}/></div></section>
      <section className="form-section"><div className="section-number">5</div><div className="section-body"><SubjectEditor kind="add" rows={data.add} update={rows => set("add", rows)}/></div></section>
      <section className="form-section"><div className="section-number">6</div><div className="section-body"><div className="section-title"><h3>Academic load</h3><p>Enter both units and hours per week before and after revision.</p></div><div className="form-grid four-col"><Field label="Before — units" required><input type="number" value={data.loadBeforeUnits} onChange={e => set("loadBeforeUnits", e.target.value)}/></Field><Field label="Before — hours/week" required><input type="number" value={data.loadBeforeHours} onChange={e => set("loadBeforeHours", e.target.value)}/></Field><Field label="After — units" required><input type="number" value={data.loadAfterUnits} onChange={e => set("loadAfterUnits", e.target.value)}/></Field><Field label="After — hours/week" required><input type="number" value={data.loadAfterHours} onChange={e => set("loadAfterHours", e.target.value)}/></Field></div></div></section>
      <section className="form-section"><div className="section-number">7</div><div className="section-body"><div className="section-title"><h3>Reason for load revision</h3><p>Select all applicable reasons and provide your printed name for the student signature area.</p></div><div className="reason-checks"><label><input type="checkbox" checked={data.conflict} onChange={e => set("conflict", e.target.checked)}/> Conflict of Schedule</label><label><input type="checkbox" checked={data.dissolved} onChange={e => set("dissolved", e.target.checked)}/> Subject/s Dissolved</label></div><Field label="Other reason/s"><textarea rows={3} value={data.otherReason} onChange={e => set("otherReason", e.target.value)} placeholder="Enter other reason/s, if applicable"/></Field><Field label="Student signature over printed name" required><input value={data.studentSignature} onChange={e => set("studentSignature", e.target.value)}/></Field></div></section>
      <section className="form-section approval-readonly"><div className="section-number">8</div><div className="section-body"><div className="section-title"><h3>Approval</h3><p>These designated areas are completed by authorized university personnel after submission.</p></div><div className="approval-slots">{["Adviser", "Chairperson", "Dean", "Registrar"].map(role => <div key={role}><Icon name="pen" size={16}/><strong>{role}</strong><span>Signature over printed name · Date</span><em>Read-only</em></div>)}</div><div className="official-fields"><span>Assessment</span><b>University personnel only</b><span>Official Receipt No.</span><b>University personnel only</b></div></div></section>
      {error && <div className="form-error-banner"><Icon name="x" size={17}/>{error}</div>}
      <div className="form-actions"><Button variant="secondary" onClick={cancel}>Cancel</Button><Button type="submit">Review and submit <Icon name="arrow" size={16}/></Button></div>
    </form>
    {confirm && <Modal title="Submit this official permit?" close={() => setConfirm(false)}><div className="confirm-icon"><Icon name="file"/></div><p>You're about to submit the <strong>Academic Load Revision Permit</strong> (FM-MSU-IIT-RGTR-008). Designated university personnel will complete the approval and signature fields.</p><div className="modal-summary"><span>Student</span><strong>{data.familyName}, {data.givenName} {data.middleName}</strong><span>Term</span><strong>{data.term}, SY {data.schoolYear}</strong></div><div className="modal-actions"><Button variant="secondary" onClick={() => setConfirm(false)}>Go back</Button><Button disabled={busy} onClick={confirmSubmit}>{busy ? "Submitting…" : "Confirm submission"}</Button></div></Modal>}
  </>;
}

function RequestForm({ type, cancel, submit, editing }: { type: string; cancel: () => void; submit: (type: string, data: unknown) => Promise<void>; editing?: RequestItem | null }) {
  return isLoadRevision(type)
    ? <LoadRevisionForm cancel={cancel} submit={permit => submit(type, permit)} initial={editing?.permit}/>
    : <GenericRequestForm type={type} cancel={cancel} submit={data => submit(type, data)} initial={editing?.details}/>;
}

function GenericRequestForm({ type, cancel, submit, initial }: { type: string; cancel: () => void; submit: (data: Record<string, string>) => Promise<void>; initial?: Record<string, string> }) {
  const user = useCurrentUser();
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [details, setDetails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(false);
  function validate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!reason.trim()) { setError(true); return; }
    setDetails(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>);   // the named inputs
    setConfirm(true);
  }
  async function confirmSubmit() {
    setBusy(true); setApiError("");
    try { await submit({ ...details, reason: reason.trim() }); }
    catch (e) { setConfirm(false); setApiError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <><div className="form-page-head"><button className="back-link" onClick={cancel}>← Back to forms</button><span>{initial ? "Revise request" : "New request"}</span><h2>{type}</h2><p>Complete the required information below. Fields marked with * are required.</p></div>
  <form className="request-form" onSubmit={validate}>
    <section className="form-section"><div className="section-number">1</div><div className="section-body"><div className="section-title"><h3>Student information</h3><p>Confirm your university and academic details.</p></div><div className="form-grid"><Field label="Student ID" required><input defaultValue={user.studentNo ?? ""} readOnly/></Field><Field label="Full name" required><input defaultValue={user.name} readOnly/></Field><Field label="Program / Course" required><select name="program" defaultValue={initial?.program ?? "BS Information Technology"}><option>BS Information Technology</option><option>BS Computer Science</option></select></Field><Field label="Year level" required><select name="yearLevel" defaultValue={initial?.yearLevel ?? "4th Year"}><option>4th Year</option><option>3rd Year</option></select></Field></div></div></section>
    <section className="form-section"><div className="section-number">2</div><div className="section-body"><div className="section-title"><h3>{type === "Load Revision Form" ? "Academic and subject details" : type === "Shifter's Application Form" ? "Program information" : "Academic information"}</h3><p>Provide the details relevant to this request.</p></div><div className="form-grid">
      {type === "Shifter's Application Form" && <><Field label="Current program" required><input name="currentProgram" defaultValue={initial?.currentProgram ?? "BS Information Technology"}/></Field><Field label="Intended program" required><input name="intendedProgram" defaultValue={initial?.intendedProgram ?? ""} placeholder="Select intended program" required/></Field></>}
      {type === "Leave of Absence Form" && <><Field label="Current academic year" required><input name="academicYear" defaultValue={initial?.academicYear ?? "2024–2025"}/></Field><Field label="Semester" required><select name="semester" defaultValue={initial?.semester ?? "Second semester"}><option>Second semester</option><option>First semester</option></select></Field></>}
    </div></div></section>
    <section className="form-section"><div className="section-number">3</div><div className="section-body"><div className="section-title"><h3>Reason for request</h3><p>{type === "Shifter's Application Form" ? "Explain your reason for enrolling in the present course and for shifting." : "Briefly explain the circumstances for this request."}</p></div><Field label={type === "Leave of Absence Form" ? "Reason for leave of absence" : type === "Shifter's Application Form" ? "Reason for shifting or transferring" : "Reason for adding or withdrawing"} required><textarea value={reason} onChange={e => {setReason(e.target.value);setError(false)}} placeholder="Provide a clear explanation to help approvers review your request…" rows={5}/>{error && <span className="error-text">Please provide a reason before continuing.</span>}</Field></div></section>
    {apiError && <div className="form-error-banner"><Icon name="x" size={17}/>{apiError}</div>}
    <div className="form-actions"><Button variant="secondary" onClick={cancel}>Cancel</Button><Button type="submit">Review and submit <Icon name="arrow" size={16}/></Button></div>
  </form>
  {confirm && <Modal title="Submit this request?" close={() => setConfirm(false)}><div className="confirm-icon"><Icon name="file"/></div><p>You're about to submit your <strong>{type}</strong>. The request will be routed to the first designated approver.</p><div className="modal-summary"><span>Student</span><strong>{user.name}</strong><span>Document</span><strong>{type}</strong></div><div className="modal-actions"><Button variant="secondary" onClick={() => setConfirm(false)}>Go back</Button><Button disabled={busy} onClick={confirmSubmit}>{busy ? "Submitting…" : "Confirm submission"}</Button></div></Modal>}</>;
}

function SubmissionSuccess({ request, done }: { request: RequestItem; done: () => void }) {
  return <div className="success-page"><div className="success-ring"><Icon name="check" size={32}/></div><span className="eyebrow">Request received</span><h2>Your document is on its way.</h2><p>We've submitted your request and notified the first designated approver. You can follow every update from My Requests.</p><div className="receipt"><span>Reference number</span><strong>{request.id}</strong><button onClick={() => navigator.clipboard?.writeText(request.id)}>Copy</button><hr/><div><span>Document</span><b>{request.type}</b></div><div><span>Status</span><StatusBadge status="Pending"/></div><div><span>Submitted</span><b>{formatDateTime(request.createdAt)}</b></div></div><div className="success-actions"><Button onClick={done}>Track my request</Button><Button variant="secondary" onClick={() => window.print()}>Print receipt</Button></div></div>;
}

function RequestsPage({ data, role, open }: { data: RequestItem[]; role: Role; open: (r: RequestItem) => void }) {
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const list = useMemo(() => data.filter(r => (filter === "All" || r.status === filter) && (r.id + r.type + r.student).toLowerCase().includes(search.toLowerCase())), [data, filter, search]);
  const filters = role === "student" ? ["All", "Pending", "Completed", "Returned for Revision", "Rejected"] : ["All", "Pending", "Approved", "Rejected", "Returned for Revision"];
  return <><div className="list-toolbar"><div className="search-box"><Icon name="search" size={18}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by reference, document, or student…"/></div><Button variant="secondary" icon="download" onClick={() => exportRequestsCsv(list, role !== "student")}>Export</Button></div><div className="filter-tabs">{filters.map(x => <button key={x} className={filter === x ? "active" : ""} onClick={() => setFilter(x)}>{x}<span>{x === "All" ? data.length : data.filter(r => r.status === x).length}</span></button>)}</div><section className="card request-list">{list.length ? <RequestTable data={list} onOpen={open} approver={role === "approver"}/> : <div className="empty"><Icon name="search" size={28}/><h3>No matching requests</h3><p>Try adjusting your search or selected status filter.</p></div>}</section></>;
}

function Detail({ request, role, back, review, revise }: { request: RequestItem; role: Role; back: () => void; review?: () => void; revise?: () => void }) {
  const facts = requestFacts(request);
  const fullyApproved = request.steps.length > 0 && request.steps.every(s => s.status === "Approved");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");
  async function download() {
    setPdfBusy(true); setPdfError("");
    try { await downloadRequestPdf(request.id); } catch (e) { setPdfError(errorMessage(e)); } finally { setPdfBusy(false); }
  }
  const stoppedBy = request.steps.find(s => s.status === "Returned" || s.status === "Rejected");
  const stopped = request.status === "Returned for Revision" || request.status === "Rejected";
  return <><button className="back-link" onClick={back}>← Back to requests</button><div className="detail-head"><div><div className="detail-title"><span className="doc-big"><Icon name="file"/></span><div><span>{request.id}</span><h2>{request.type}</h2><p>Submitted by {request.student} on {request.date}</p></div></div></div><div className="detail-actions"><StatusBadge status={request.status}/>{fullyApproved && <Button icon="download" disabled={pdfBusy} onClick={download}>{pdfBusy ? "Preparing PDF…" : "Download PDF"}</Button>}{role === "approver" && request.status === "Pending" && <Button onClick={review}>Review request</Button>}</div></div>
  {pdfError && <div className="form-error-banner" style={{ marginBottom: 16 }}><Icon name="x" size={17}/>{pdfError}</div>}
  {stopped && <div className="return-banner"><Icon name={request.status === "Rejected" ? "x" : "rotate"}/><div><strong>{request.status === "Rejected" ? "Rejected" : "Changes requested"} by {stoppedBy?.actorName ?? "the approver"}</strong><p>{request.reason}</p></div>{request.status === "Returned for Revision" && role === "student" && <Button variant="secondary" onClick={revise}>Revise form</Button>}</div>}
  {request.permit && <PermitProgress permit={request.permit}/>}
  <div className="detail-grid"><div><section className="card info-card"><div className="card-head"><div><h3>Submitted information</h3><p>Information provided with this request.</p></div></div><div className="info-grid">{facts.infos.map(([label, value]) => <Info key={label} label={label} value={value}/>)}</div><div className="reason-box"><span>Reason for request</span><p>{facts.reason}</p></div></section><section className="card history-card"><div className="card-head"><div><h3>Status history</h3><p>A complete record of actions on this document.</p></div></div>
    {request.events ? request.events.map((e, i) => <div className="history-item" key={i}><span className={`avatar tiny ${e.action === "submitted" || e.action === "resubmitted" ? "" : "dark"}`}>{initials(e.actorName ?? "?")}</span><div><strong>{eventTitle(e)}</strong><p>{eventText(e, request)}</p><small>{formatDateTime(e.at)}</small></div></div>) : <p className="small">Loading history…</p>}
  </section></div>
  <aside className="card timeline-card"><h3>Approval progress</h3><p>Current routing and signatory status.</p><div className="full-timeline"><StepsTimeline request={request}/></div><div className="sequence-note">Requests are signed in order: Adviser, Chairperson, then College Dean.</div><hr/><h4>Need assistance?</h4><p className="small">Contact the Office of the University Registrar at registrar@msuiit.edu.ph.</p></aside></div></>;
}

// The boxes signed electronically, in order. (Controller / Instructor / Registrar boxes are completed on the printed copy.)
const ESIGN_SLOTS = ["Adviser", "Chairperson", "Dean"];

function PermitProgress({ permit }: { permit: LoadRevisionPermit }) {
  return <section className="card permit-progress"><div><span className="eyebrow">FM-MSU-IIT-RGTR-008</span><h3>Permit signature status</h3><p>The Adviser, Chairperson and College Dean sign electronically, in that order. The Controller, Instructor and Registrar boxes are completed on the printed copy.</p></div><div>{ESIGN_SLOTS.map(slot => <span className={permit.signatures[slot] ? "complete" : ""} key={slot}><Icon name={permit.signatures[slot] ? "check" : "clock"} size={13}/><b>{slot}</b><small>{permit.signatures[slot] || "Pending"}</small></span>)}</div></section>;
}

function Info({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }

function ApproverDashboard({ navigate, open, queue }: { navigate: (p: Page) => void; open: (r: RequestItem) => void; queue: RequestItem[] }) {
  const user = useCurrentUser();
  const pending = queue.filter(r => r.status === "Pending");
  return <><div className="welcome-row"><div><span className="eyebrow">Approver workspace</span><h2>Good morning, {greetingName(user)}.</h2><p>{pending.length} document{pending.length === 1 ? " is" : "s are"} waiting for your review.</p></div><Button variant="secondary" onClick={() => navigate("requests")}>View approval queue</Button></div><div className="stats-grid"><StatCard label="Pending approvals" value={pending.length} icon="clock" tone="tone-amber"/><StatCard label="Approved documents" value={queue.filter(r => r.status === "Approved").length} icon="check" tone="tone-green"/><StatCard label="Rejected documents" value={queue.filter(r => r.status === "Rejected").length} icon="x" tone="tone-red"/><StatCard label="Returned for revision" value={queue.filter(r => r.status === "Returned for Revision").length} icon="rotate" tone="tone-blue"/></div><section className="card table-card"><div className="card-head"><div><h3>Requests awaiting action</h3><p>Prioritized by submission date and routing order.</p></div><Button variant="ghost" onClick={() => navigate("requests")}>View full queue <Icon name="arrow" size={15}/></Button></div><RequestTable data={pending} onOpen={open} approver/></section><div className="approver-foot"><div className="card quick-card"><div className="stat-icon tone-maroon"><Icon name="pen"/></div><div><h3>Your e-signature is ready</h3><p>Last updated April 12, 2025. It will only be applied after your approval confirmation.</p></div><Button variant="secondary" onClick={() => navigate("signature")}>Manage signature</Button></div><div className="card reminder"><Icon name="clock"/><div><strong>You sign as</strong><span>{user.position}</span></div></div></div></>;
}

function GenericReviewPage({ request, finish, back, signature, goSignature }: { request: RequestItem; finish: (action: Status, reason?: string) => Promise<void>; back: () => void; signature: string | null; goSignature: () => void }) {
  const facts = requestFacts(request);
  const [zoom, setZoom] = useState(100);
  const [tab, setTab] = useState<"details" | "history">("details");
  const [dialog, setDialog] = useState<"approve" | "reject" | "return" | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function decide() {
    if (!dialog) return;
    setBusy(true); setErr("");
    try { await finish(dialog === "approve" ? "Approved" : dialog === "reject" ? "Rejected" : "Returned for Revision", comment); }
    catch (e) { setErr(errorMessage(e)); setBusy(false); }
  }
  return <><button className="back-link" onClick={back}>← Back to approval queue</button><div className="review-top"><div><span>{request.id}</span><h2>{request.type}</h2><p>Submitted by {request.student} · {request.date}</p></div><StatusBadge status="Pending"/></div><div className="review-grid"><section className="document-preview"><div className="preview-bar"><span>Document preview</span><div><button aria-label="Zoom out" onClick={() => setZoom(z => Math.max(60, z - 10))}>−</button><b>{zoom}%</b><button aria-label="Zoom in" onClick={() => setZoom(z => Math.min(140, z + 10))}>+</button><button aria-label="Download PDF" disabled title="The PDF is available after all approvals are complete"><Icon name="download" size={16}/></button></div></div><div className="paper" style={{ zoom: zoom / 100 }}><div className="paper-brand"><div className="mini-seal">MSU<br/>IIT</div><div><strong>Mindanao State University</strong><span>Iligan Institute of Technology</span><small>OFFICE OF THE UNIVERSITY REGISTRAR</small></div></div><hr/><h3>{request.type.toUpperCase()}</h3><div className="paper-row"><span>Student Name</span><b>{request.student}</b><span>Student ID</span><b>{request.studentNo ?? "—"}</b></div><div className="paper-row"><span>Program</span><b>{facts.program}</b><span>Year Level</span><b>{facts.yearLevel}</b></div><div className="paper-block"><span>Reason for request</span><p>{facts.reason}</p></div><div className="signature-lines"><div><i/><span>Student signature</span></div>{request.steps.map(s => <div key={s.order}>{s.signatureImage && <img src={s.signatureImage} alt={`Signature of ${s.actorName}`} style={{ height: 30, maxWidth: "100%", objectFit: "contain", marginBottom: -6 }}/>}<i/><span>{s.position}</span>{s.status === "Approved" && <em>Approved</em>}</div>)}</div></div></section><aside className="review-panel"><div className="review-tabs"><button className={tab === "details" ? "active" : ""} onClick={() => setTab("details")}>Details</button><button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>History</button></div>{tab === "details" ? <><div className="review-section"><h3>Student information</h3><Info label="Student ID" value={request.studentNo ?? "—"}/><Info label="Email" value={request.studentEmail ?? "—"}/><Info label="Program" value={facts.program}/><Button variant="ghost" icon="mail" onClick={() => contactStudent(request)}>Contact student</Button></div><div className="review-section"><h3>Previous approval</h3>{(() => { const prev = [...request.steps].reverse().find(s => s.status === "Approved"); return prev ? <div className="previous"><span className="avatar tiny dark">{initials(prev.actorName ?? "?")}</span><div><strong>{prev.actorName}</strong><small>{prev.position} · Approved {prev.actedAt ? formatDateTime(prev.actedAt) : ""}</small>{prev.comment && <p>“{prev.comment}”</p>}</div></div> : <p className="small">No earlier approvals. You are the first signer.</p>; })()}</div></> : <HistoryList request={request}/>}<div className="action-box"><span className="eyebrow">Your decision</span><p>Review all submitted information before taking action.</p><Button variant="success" icon="check" onClick={() => setDialog("approve")}>Approve and sign</Button><div><Button variant="secondary" onClick={() => setDialog("return")}>Return for revision</Button><Button variant="danger" onClick={() => setDialog("reject")}>Reject</Button></div></div></aside></div>
  {dialog && <Modal title={dialog === "approve" ? "Approve and sign document?" : dialog === "reject" ? "Reject this request?" : "Return for revision?"} close={() => setDialog(null)}><div className={`confirm-icon ${dialog}`}><Icon name={dialog === "approve" ? "check" : dialog === "reject" ? "x" : "rotate"}/></div><p>{dialog === "approve" ? "Your saved e-signature will be applied and the document will move to the next approval stage." : "Provide a clear reason. The student will receive this message with the status update."}</p>{dialog === "approve" && <SignaturePreview signature={signature} goSignature={goSignature}/>}{dialog !== "approve" && <textarea rows={4} value={comment} onChange={e => setComment(e.target.value)} placeholder={dialog === "reject" ? "Reason for rejection…" : "What should the student revise?"}/>}{err && <div className="error-text">{err}</div>}<div className="modal-actions"><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button variant={dialog === "approve" ? "success" : dialog === "reject" ? "danger" : "primary"} disabled={busy || (dialog === "approve" ? !signature : !comment.trim())} onClick={decide}>{busy ? "Saving…" : dialog === "approve" ? "Approve document" : "Confirm decision"}</Button></div></Modal>}</>;
}

function PermitSignature({ label, value, image }: { label: string; value?: string; image?: string }) {
  return <div className={`permit-signature ${value ? "signed" : ""}`}>{image ? <><img src={image} alt={`Signature of ${value}`} style={{ height: 30, maxWidth: "100%", objectFit: "contain" }}/><span style={{ fontSize: 7, textAlign: "center", fontWeight: 700 }}>{value}</span></> : value ? <span className="script-signature">{value}</span> : <i/>}<small>{label}</small></div>;
}

function OfficialPermitPreview({ permit }: { permit: LoadRevisionPermit }) {
  const fullName = `${permit.familyName}, ${permit.givenName} ${permit.middleName}`.trim();
  return <div className="official-paper">
    <div className="official-header">
      <div className="official-mark">MSU<br/>IIT</div>
      <div><strong>ILIGAN INSTITUTE OF TECHNOLOGY</strong><span>MINDANAO STATE UNIVERSITY</span></div>
      <div className="document-meta"><span>OFFICE OF THE REGISTRAR</span><b>Document Code No.</b><strong>FM-MSU-IIT-RGTR-008</strong><small>Revision No. 00 · Effective 02.20.2020 · Page 1 of 1</small></div>
    </div>
    <h3>ACADEMIC LOAD REVISION PERMIT</h3>
    <div className="permit-part"><b>PART 1</b><div className="permit-term"><span>{permit.term === "1st Semester" ? "☒" : "☐"} 1ST Semester</span><span>{permit.term === "2nd Semester" ? "☒" : "☐"} 2ND Semester</span><span>{permit.term === "Summer Term" ? "☒" : "☐"} Summer Term</span><strong>School Year: {permit.schoolYear}</strong></div></div>
    <div className="permit-part"><b>PART 2</b><div className="permit-columns"><div><small>FULL NAME (Family, Given, Middle)</small><strong>{fullName}</strong></div><div><small>I.D. No.</small><strong>{permit.studentId}</strong></div><div><small>Date</small><strong>{permit.permitDate}</strong></div></div></div>
    <div className="permit-part"><b>PART 3</b><div className="permit-columns"><div><small>COLLEGE / SCHOOL</small><strong>{permit.college}</strong></div><div><small>DEPARTMENT</small><strong>{permit.department}</strong></div><div><small>COURSE & YEAR</small><strong>{permit.courseYear}</strong></div></div></div>
    <div className="permit-part subject-part"><b>PART 4</b><div><h4>WITHDRAW from the following subject/s:</h4><div className="permit-subject-head"><span>COURSE NO. & SEC.</span><span>COURSE TITLE</span><span>UNITS</span><span>CONTROLLER</span><span>PROFESSOR</span></div>{permit.withdraw.map((row, index) => <div className="permit-subject-row" key={`withdraw-${index}`}><strong>{row.course || "—"}</strong><strong>{row.title || "—"}</strong><strong>{row.units || "—"}</strong><PermitSignature label="Signature over Printed Name" value={permit.signatures[`Withdraw Controller ${index + 1}`]}/><PermitSignature label="Signature over Printed Name" value={permit.signatures[`Withdraw Professor ${index + 1}`]}/></div>)}<p className="permit-note">Note: WITHDRAW FROM ALL SUBJECTS. Attach letter stating reason/s and file leave of absence (Form 11) if planning to enroll in the Institute within one (1) year.</p></div></div>
    <div className="permit-part subject-part"><b>PART 5</b><div><h4>ADD the following subject/s:</h4><div className="permit-subject-head add-head"><span>NO.</span><span>COURSE NO. & SEC.</span><span>COURSE TITLE</span><span>UNITS</span><span>CONTROLLER</span></div>{permit.add.map((row, index) => <div className="permit-subject-row add-row" key={`add-${index}`}><strong>{index + 1}</strong><strong>{row.course || "—"}</strong><strong>{row.title || "—"}</strong><strong>{row.units || "—"}</strong><PermitSignature label="Signature over Printed Name" value={permit.signatures[`Add Controller ${index + 1}`]}/></div>)}<h5>APPROVAL of Instructor/s for closed subject/s:</h5><div className="closed-approvals">{permit.add.map((row, index) => <PermitSignature key={`closed-${index}`} label={`Subject ${index + 1}${row.closed ? " · Closed" : " · Not applicable"}`} value={row.closed ? permit.signatures[`Closed Instructor ${index + 1}`] : undefined}/>)}</div></div></div>
    <div className="permit-part"><b>PART 6</b><div className="load-totals"><strong>TOTAL LOAD before Revision <u>{permit.loadBeforeUnits}</u> units; <u>{permit.loadBeforeHours}</u> hours/week</strong><strong>TOTAL LOAD after Revision <u>{permit.loadAfterUnits}</u> units; <u>{permit.loadAfterHours}</u> hours/week</strong></div></div>
    <div className="permit-part"><b>PART 7</b><div className="permit-reasons"><strong>REASON/S for Load Revision</strong><p>{permit.conflict ? "☒" : "☐"} Conflict of Schedule &nbsp;&nbsp; {permit.dissolved ? "☒" : "☐"} Subject/s Dissolved &nbsp;&nbsp; Other reason/s: <u>{permit.otherReason || "—"}</u></p><PermitSignature label="Student's Signature over Printed Name" value={permit.studentSignature}/></div></div>
    <div className="permit-part"><b>PART 8</b><div className="permit-approval"><strong>APPROVAL:</strong>{["Adviser", "Chairperson", "Dean", "Registrar"].map(role => <div className="approval-line" key={role}><b>{role}</b><PermitSignature label="Signature over Printed Name" value={permit.signatures[role]} image={permit.signatureImages?.[role]}/><span>Date: ____________</span>{role === "Adviser" && <span>Assessment Php ____________</span>}{role === "Chairperson" && <span>O.R. No. ____________</span>}</div>)}</div></div>
    <p className="copies-note">Accomplish in 3 copies – for the Registrar, the Department and the Student.</p>
    <div className="official-footer"><span>A. Bonifacio Avenue, Tibanga, 9200 Iligan City</span><span>Website: www.msuiit.edu.ph</span><span>Registrar: registrar@g.msuiit.edu.ph</span></div>
  </div>;
}

function OfficialReviewPage({ request, finish, back, signature, goSignature }: { request: RequestItem; finish: (action: Status, reason?: string) => Promise<void>; back: () => void; signature: string | null; goSignature: () => void }) {
  const user = useCurrentUser();
  const permit = request.permit ?? defaultPermit;
  const signatureSlots = [
    ...permit.withdraw.flatMap((_, i) => [`Withdraw Controller ${i + 1}`, `Withdraw Professor ${i + 1}`]),
    ...permit.add.flatMap((row, i) => [`Add Controller ${i + 1}`, ...(row.closed ? [`Closed Instructor ${i + 1}`] : [])]),
    "Adviser", "Chairperson", "Dean", "Registrar",
  ];
  // Your position decides which box you sign; the server enforces the order.
  const slot = user.position === "College Dean" ? "Dean" : (user.position ?? "");
  const [dialog, setDialog] = useState<"approve" | "reject" | "return" | null>(null);
  const [comment, setComment] = useState("");
  const [tab, setTab] = useState<"signatures" | "history">("signatures");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function decide() {
    if (!dialog) return;
    setBusy(true); setErr("");
    try { await finish(dialog === "approve" ? "Approved" : dialog === "reject" ? "Rejected" : "Returned for Revision", comment); }
    catch (e) { setErr(errorMessage(e)); setBusy(false); }
  }
  return <><button className="back-link" onClick={back}>← Back to approval queue</button><div className="review-top"><div><span>{request.id} · FM-MSU-IIT-RGTR-008</span><h2>Academic Load Revision Permit</h2><p>Submitted by {request.student} · {request.date}</p></div><StatusBadge status={request.status}/></div>
    <div className="review-grid"><section className="document-preview official-preview"><div className="preview-bar"><span>Official template preview · Read-only</span><div><b>Fit to page</b><button aria-label="Download PDF" disabled title="The PDF is available after all approvals are complete"><Icon name="download" size={16}/></button></div></div><OfficialPermitPreview permit={permit}/></section>
      <aside className="review-panel"><div className="review-tabs"><button className={tab === "signatures" ? "active" : ""} onClick={() => setTab("signatures")}>Signatures</button><button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>History</button></div>{tab === "signatures" ? <><div className="review-section"><h3>Submitted information</h3><Info label="Student ID" value={permit.studentId}/><Info label="Academic term" value={`${permit.term}, SY ${permit.schoolYear}`}/><Info label="Course and year" value={permit.courseYear}/><Button variant="ghost" icon="mail" onClick={() => contactStudent(request)}>Contact student</Button></div>
        <div className="review-section signature-routing"><h3>Designated signature field</h3><p>Your position decides which field you sign. Signatures are collected in order: Adviser, Chairperson, then College Dean.</p><select value={slot} disabled><option value={slot}>{slot}</option></select><div className="slot-status"><Icon name={permit.signatures[slot] ? "check" : "clock"} size={15}/><span>{permit.signatures[slot] ? `Signed by ${permit.signatures[slot]}` : "Awaiting authorized signature"}</span></div></div>
        <div className="review-section"><h3>Signature coverage</h3><div className="coverage-list">{ESIGN_SLOTS.map(name => <div key={name}><Icon name={permit.signatures[name] ? "check" : "clock"} size={13}/><span>{name}</span><b>{permit.signatures[name] ? "Signed" : "Pending"}</b></div>)}</div></div>
        </> : <HistoryList request={request}/>}<div className="action-box"><span className="eyebrow">Your decision</span><p>Approving places your name in the “{slot}” field and sends the permit to the next signer.</p><Button variant="success" icon="check" onClick={() => setDialog("approve")}>Approve and sign field</Button><div><Button variant="secondary" onClick={() => setDialog("return")}>Return for revision</Button><Button variant="danger" onClick={() => setDialog("reject")}>Reject</Button></div></div>
      </aside></div>
    {dialog && <Modal title={dialog === "approve" ? `Sign ${slot}?` : dialog === "reject" ? "Reject this request?" : "Return for revision?"} close={() => setDialog(null)}><div className={`confirm-icon ${dialog}`}><Icon name={dialog === "approve" ? "pen" : dialog === "reject" ? "x" : "rotate"}/></div><p>{dialog === "approve" ? `Your name will be placed in the “${slot}” field and the permit will move to the next signer.` : "Provide a clear reason. The student will receive this message with the status update."}</p>{dialog === "approve" && <SignaturePreview signature={signature} goSignature={goSignature}/>}{dialog !== "approve" && <textarea rows={4} value={comment} onChange={e => setComment(e.target.value)} placeholder={dialog === "reject" ? "Reason for rejection…" : "What should the student revise?"}/>}{err && <div className="error-text">{err}</div>}<div className="modal-actions"><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button variant={dialog === "approve" ? "success" : dialog === "reject" ? "danger" : "primary"} disabled={busy || (dialog === "approve" ? !signature : !comment.trim())} onClick={decide}>{busy ? "Saving…" : dialog === "approve" ? "Place signature" : "Confirm decision"}</Button></div></Modal>}
  </>;
}

function ReviewPage({ request, finish, back, signature, goSignature }: { request: RequestItem; finish: (action: Status, reason?: string) => Promise<void>; back: () => void; signature: string | null; goSignature: () => void }) {
  return isLoadRevision(request.type) ? <OfficialReviewPage request={request} finish={finish} back={back} signature={signature} goSignature={goSignature}/> : <GenericReviewPage request={request} finish={finish} back={back} signature={signature} goSignature={goSignature}/>;
}

function Notifications({ items, onReadAll, onOpen }: { items: AppNotification[]; onReadAll: () => void; onOpen: (n: AppNotification) => void }) {
  const [onlyUnread, setOnlyUnread] = useState(false);
  const unread = items.filter(n => !n.read).length;
  const shown = onlyUnread ? items.filter(n => !n.read) : items;
  const tone = (kind: string) => kind === "check" ? "green" : kind === "rotate" ? "amber" : kind === "x" ? "red" : "maroon";
  return <section className="card notification-card"><div className="card-head"><div><h3>All notifications</h3><p>Updates about documents and approval activity.</p></div><Button variant="ghost" disabled={unread === 0} onClick={onReadAll}>Mark all as read</Button></div><div className="notification-filter"><button className={onlyUnread ? "" : "active"} onClick={() => setOnlyUnread(false)}>All</button><button className={onlyUnread ? "active" : ""} onClick={() => setOnlyUnread(true)}>Unread <span>{unread}</span></button></div>
    {shown.length === 0 ? <div className="empty"><Icon name="bell" size={28}/><h3>{onlyUnread ? "No unread notifications" : "No notifications yet"}</h3><p>Updates about your documents will appear here.</p></div>
      : shown.map(n => <div className={`notification-item ${n.read ? "" : "unread"}`} key={n.id}><div className={`notification-icon tone-${tone(n.kind)}`}><Icon name={n.kind}/></div><div><strong>{n.title}</strong><p>{n.message}</p><small>{timeAgo(n.createdAt)}</small></div>{!n.read && <i/>}<button aria-label="Open" onClick={() => onOpen(n)}><Icon name="chevron" size={16}/></button></div>)}
  </section>;
}

export default function App() {
  const { user, loading } = useAuth();
  const role: Role = user?.role ?? "student";
  const [page, setPage] = useState<Page>("dashboard");
  // A different person signing in always starts on the dashboard
  useEffect(() => { setPage("dashboard"); }, [user?.id]);
  const [selectedType, setSelectedType] = useState("Load Revision Form");
  const [selectedRequest, setSelectedRequest] = useState<RequestItem | null>(null);
  const [editing, setEditing] = useState<RequestItem | null>(null);          // set while revising a returned request
  const [requests, setRequests] = useState<RequestItem[]>([]);              // a student's own requests, or an approver's queue
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [mySignature, setMySignature] = useState<SavedSignature | null | undefined>(undefined);   // undefined = still loading (approvers only)
  const [loadError, setLoadError] = useState("");
  const [submitted, setSubmitted] = useState<RequestItem | null>(null);

  // Everything on screen comes from the server: load it on sign-in, then re-check every 30 seconds.
  const refresh = useCallback(async () => {
    try {
      const [list, notes, sig] = await Promise.all([listRequests(), listNotifications(), role === "approver" ? getSignature() : Promise.resolve(undefined)]);
      setRequests(list); setNotifications(notes.notifications); setUnread(notes.unreadCount); setLoadError("");
      if (sig !== undefined) setMySignature(sig);
    } catch (e) { setLoadError(errorMessage(e)); }
  }, [role]);
  useEffect(() => {
    if (!user) { setRequests([]); setNotifications([]); setUnread(0); setMySignature(undefined); setSelectedRequest(null); setSubmitted(null); setEditing(null); return; }
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [user?.id, refresh]);

  const open = (r: RequestItem) => {
    setSelectedRequest(r); setPage("detail");
    // The list has no history; fetch the full record (and quietly keep the list data if that fails).
    getRequest(r.id).then(full => setSelectedRequest(cur => cur?.id === full.id ? full : cur)).catch(() => {});
  };
  const openByRef = (ref: string) => getRequest(ref).then(full => { setSelectedRequest(full); setPage("detail"); }).catch(e => setLoadError(errorMessage(e)));

  // Errors are thrown to the form, which shows them to the student.
  const submitRequest = async (type: string, data: unknown) => {
    const saved = editing ? await resubmitRequest(editing.id, data) : await createRequest(canonicalType(type), data);
    setEditing(null); setSubmitted(saved);
    await refresh();
  };
  const revise = () => { if (!selectedRequest) return; setEditing(selectedRequest); setSelectedType(selectedRequest.type); setPage("form"); };
  const finishReview = async (status: Status, reason?: string) => {
    if (!selectedRequest) return;
    const decision = status === "Approved" ? "approve" : status === "Rejected" ? "reject" : "return";
    const updated = await decideRequest(selectedRequest.id, decision, reason ?? "");
    setSelectedRequest(updated); setPage("detail");
    await refresh();
  };
  const readAll = () => markAllNotificationsRead().then(refresh).catch(e => setLoadError(errorMessage(e)));
  const openNotification = (n: AppNotification) => {
    if (!n.read) markNotificationRead(n.id).then(refresh).catch(() => {});
    if (n.requestRef) openByRef(n.requestRef);
  };

  if (loading) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#68717d" }}>Loading…</div>;
  if (!user) return <Login/>;
  if (submitted) return <Shell role={role} page="requests" unread={unread} navigate={p => {setSubmitted(null);setPage(p)}} title="Request submitted" subtitle="Your document has entered the approval workflow."><SubmissionSuccess request={submitted} done={() => {setSelectedRequest(submitted);setSubmitted(null);setPage("detail");open(submitted)}}/></Shell>;
  let title = "Dashboard", subtitle = role === "student" ? "An overview of your university document requests." : "Review and manage documents assigned to you.";
  if (page === "new") { title = "New document request"; subtitle = "Choose a form to begin your submission."; }
  if (page === "form") { title = editing ? "Revise request" : "Complete request"; subtitle = editing ? "Update your answers and resubmit for approval." : "Provide the required document information."; }
  if (page === "requests") { title = role === "student" ? "My requests" : "Pending approvals"; subtitle = role === "student" ? "Search, filter, and track all your document requests." : "Documents currently awaiting your review."; }
  if (page === "detail") { title = "Request details"; subtitle = "Review submitted information and approval progress."; }
  if (page === "review") { title = "Document review"; subtitle = "Verify information and record your decision."; }
  if (page === "signature") { title = "My e-signature"; subtitle = "Create and manage your signature for document approvals."; }
  if (page === "notifications") { title = "Notifications"; subtitle = "Stay informed about document activity and updates."; }
  if (page === "settings") { title = "Profile & settings"; subtitle = "Manage your account preferences."; }
  return <Shell role={role} page={page} unread={unread} navigate={setPage} title={title} subtitle={subtitle}>
    {loadError && <div className="form-error-banner" style={{ marginBottom: 16 }}><Icon name="x" size={17}/>Couldn't load the latest data: {loadError}</div>}
    {page === "dashboard" && (role === "student" ? <StudentDashboard navigate={setPage} open={open} requests={requests}/> : <ApproverDashboard navigate={setPage} open={open} queue={requests}/>)}
    {page === "new" && <NewRequest select={type => {setEditing(null);setSelectedType(type);setPage("form")}}/>}
    {page === "form" && <RequestForm type={selectedType} editing={editing} cancel={() => {setPage(editing ? "detail" : "new");setEditing(null)}} submit={submitRequest}/>}
    {page === "requests" && <RequestsPage data={requests} role={role} open={open}/>}
    {page === "detail" && selectedRequest && <Detail request={selectedRequest} role={role} back={() => setPage("requests")} review={() => setPage("review")} revise={revise}/>}
    {page === "review" && selectedRequest && <ReviewPage request={selectedRequest} finish={finishReview} back={() => setPage("detail")} signature={mySignature?.imageData ?? null} goSignature={() => setPage("signature")}/>}
    {page === "signature" && <SignaturePage signature={mySignature} onChange={setMySignature}/>}
    {page === "notifications" && <Notifications items={notifications} onReadAll={readAll} onOpen={openNotification}/>}
    {page === "settings" && <section className="card settings-placeholder"><div className="avatar large">{initials(user.name)}</div><h2>{user.name}</h2><p>{user.email}</p><div className="info-grid"><Info label="University affiliation" value="MSU–IIT"/><Info label="Account role" value={role === "student" ? "Student" : `Approver · ${user.position}`}/><Info label="Notification preference" value="Email and in-app"/><Info label="Account status" value="Active"/></div></section>}
  </Shell>;
}
