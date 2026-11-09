export const isLoadRevision = (type: string) => type.includes("Load Revision");

/** The form cards are titled "Academic Load Revision Permit", but the system knows that form as "Load Revision Form". */
export const canonicalType = (type: string) => (isLoadRevision(type) ? "Load Revision Form" : type);
