import { defaultPermit } from "@/mocks/seed";
import type { LoadRevisionPermit, User } from "@/types";
import { stripTitle } from "./format";

/** A fresh permit form for this student: their own name, ID, college and department filled in. */
export function permitTemplate(user: User): LoadRevisionPermit {
  const parts = stripTitle(user.name).split(/\s+/).filter(Boolean);
  return {
    ...defaultPermit,
    givenName: parts[0] ?? "",
    middleName: parts.length > 2 ? parts.slice(1, -1).join(" ") : "",
    familyName: parts.length > 1 ? parts[parts.length - 1] : "",
    studentId: user.studentNo ?? "",
    college: user.college ?? defaultPermit.college,
    department: user.department ?? defaultPermit.department,
    studentSignature: user.name,
    permitDate: new Date().toISOString().slice(0, 10),
    signatures: {},
  };
}
