const TITLE = /^(dr|prof|engr|atty|mr|ms|mrs)\.$/i;

/** "Dr. Maria L. Reyes" -> "Maria L. Reyes" */
export const stripTitle = (name: string) => name.replace(/^(dr|prof|engr|atty|mr|ms|mrs)\.\s+/i, "");

/** "Andrea M. Santos" -> "AS" (skips titles and middle initials) */
export function initials(name: string) {
  const words = name.split(/\s+/).filter(w => w && !w.endsWith("."));
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Students are greeted by first name ("Andrea"); titled staff by title + surname ("Dr. Reyes"). */
export function greetingName(user: { name: string; role: string }) {
  const words = user.name.split(/\s+/).filter(Boolean);
  if (user.role === "approver" && words.length > 1 && TITLE.test(words[0])) return `${words[0]} ${words[words.length - 1]}`;
  return stripTitle(user.name).split(/\s+/)[0] ?? user.name;
}

const parse = (iso: string) => new Date(iso);

/** "2025-05-22T01:14:00Z" -> "May 22, 2025" (in the viewer's timezone) */
export const formatDate = (iso: string) =>
  parse(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** -> "May 22, 2025 · 9:14 AM" */
export const formatDateTime = (iso: string) =>
  `${formatDate(iso)} · ${parse(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

/** -> "8 minutes ago", "Yesterday", or a date for anything older */
export function timeAgo(iso: string, now = Date.now()) {
  const minutes = Math.round((now - parse(iso).getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (hours < 48) return "Yesterday";
  return formatDate(iso);
}

/** "Monday, May 26" */
export const todayLabel = () =>
  new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
