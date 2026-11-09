import type { LoadRevisionPermit } from "@/types";

// Starting values for the permit form (the example subjects from the Figma design).
// Requests themselves now come from the API.
export const defaultPermit: LoadRevisionPermit = {
  term: "2nd Semester",
  schoolYear: "2024–2025",
  familyName: "Santos",
  givenName: "Andrea",
  middleName: "M.",
  studentId: "2021-1234",
  permitDate: "2025-05-26",
  college: "College of Computer Studies",
  department: "Information Technology Department",
  courseYear: "BS Information Technology – 4th Year",
  withdraw: [{ course: "IT 138 – A", title: "Information Assurance and Security", units: "3" }],
  add: [{ course: "IT 141 – B", title: "Systems Integration and Architecture", units: "3", closed: false }],
  loadBeforeUnits: "18",
  loadBeforeHours: "21",
  loadAfterUnits: "18",
  loadAfterHours: "21",
  conflict: true,
  dissolved: false,
  otherReason: "",
  studentSignature: "Andrea M. Santos",
  signatures: { Adviser: "Prof. Ramon C. Flores" },
};
