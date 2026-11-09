// Shared types. They double as the API contract: the backend returns these shapes.
export type Role = "student" | "approver";
export type Page =
  | "login"
  | "dashboard"
  | "new"
  | "form"
  | "requests"
  | "detail"
  | "review"
  | "signature"
  | "notifications"
  | "settings";
export type Status = "Pending" | "Approved" | "Rejected" | "Returned for Revision" | "Completed";

export type SubjectRow = {
  course: string;
  title: string;
  units: string;
  closed?: boolean;
};

export type LoadRevisionPermit = {
  term: "1st Semester" | "2nd Semester" | "Summer Term";
  schoolYear: string;
  familyName: string;
  givenName: string;
  middleName: string;
  studentId: string;
  permitDate: string;
  college: string;
  department: string;
  courseYear: string;
  withdraw: SubjectRow[];
  add: SubjectRow[];
  loadBeforeUnits: string;
  loadBeforeHours: string;
  loadAfterUnits: string;
  loadAfterHours: string;
  conflict: boolean;
  dissolved: boolean;
  otherReason: string;
  studentSignature: string;
  signatures: Record<string, string>;
  signatureImages?: Record<string, string>;   // signature pictures by box name (Adviser / Chairperson / Dean); single-request fetch only
};

export type StepStatus = "Waiting" | "Pending" | "Approved" | "Rejected" | "Returned";

/** One signer in the approval chain (Adviser → Chairperson → College Dean). */
export type StepInfo = {
  order: number;
  position: Position;
  status: StepStatus;
  actorName: string | null;
  comment: string | null;
  actedAt: string | null;
  signed: boolean;                       // a signature image was stamped on this step
  signatureImage?: string | null;        // the image itself: only on the single-request fetch, never in lists
};

export type EventInfo = {
  action: "submitted" | "approved" | "returned" | "rejected" | "resubmitted";
  actorName: string | null;
  actorPosition: Position | null;
  comment: string | null;
  at: string;
};

export type RequestItem = {
  id: string;                 // the reference number, e.g. IIT-2025-1048
  type: string;
  student: string;
  studentNo: string | null;
  studentEmail: string | null;
  createdAt: string;          // ISO timestamp from the server
  date: string;               // createdAt formatted for display
  stage: string;
  status: Status;             // for approvers: the status of THEIR step
  reason?: string;            // why it was returned/rejected
  permit?: LoadRevisionPermit;            // Load Revision Form content
  details?: Record<string, string>;       // other forms' content
  steps: StepInfo[];
  events?: EventInfo[];       // only on the single-request fetch
};

export type NotificationKind = "file" | "check" | "rotate" | "clock" | "x";

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  requestRef: string | null;
};

export type Position = "Adviser" | "Chairperson" | "College Dean";

/** The signed-in user, as returned by the API (never includes the password). */
export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  position: Position | null;
  studentNo: string | null;
  college: string | null;
  department: string | null;
};
