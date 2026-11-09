import type { AppNotification, RequestItem } from "@/types";
import { formatDate } from "@/lib/format";
import { saveBlob } from "@/lib/download";
import { api, apiBlob } from "./client";

// What the server sends; `normalize` turns it into the RequestItem the screens use.
type RequestDto = Omit<RequestItem, "date" | "reason"> & { reason: string | null };
const normalize = (d: RequestDto): RequestItem => ({ ...d, reason: d.reason ?? undefined, date: formatDate(d.createdAt) });
const path = (id: string) => `/requests/${encodeURIComponent(id)}`;

export const listRequests = () =>
  api<{ requests: RequestDto[] }>("/requests").then(r => r.requests.map(normalize));

export const getRequest = (id: string) =>
  api<{ request: RequestDto }>(path(id)).then(r => normalize(r.request));

export const createRequest = (type: string, data: unknown) =>
  api<{ request: RequestDto }>("/requests", { body: { type, data } }).then(r => normalize(r.request));

/** Edit and resubmit a request that was returned for revision. */
export const resubmitRequest = (id: string, data: unknown) =>
  api<{ request: RequestDto }>(path(id), { method: "PUT", body: { data } }).then(r => normalize(r.request));

export type Decision = "approve" | "return" | "reject";
/** `note` is the optional comment when approving, and the required reason when returning/rejecting. */
export const decideRequest = (id: string, decision: Decision, note: string) =>
  api<{ request: RequestDto }>(`${path(id)}/${decision}`, {
    method: "POST",
    body: decision === "approve" ? { comment: note.trim() || undefined } : { reason: note.trim() },
  }).then(r => normalize(r.request));

/** Downloads the official PDF (only available once every approval is in). */
export const downloadRequestPdf = (id: string) => apiBlob(`${path(id)}/pdf`).then(blob => saveBlob(blob, `${id}.pdf`));

export const listNotifications = () =>
  api<{ notifications: AppNotification[]; unreadCount: number }>("/notifications");
export const markAllNotificationsRead = () => api<{ ok: true }>("/notifications/read-all", { method: "POST" });
export const markNotificationRead = (id: string) => api<{ ok: true }>(`/notifications/${id}/read`, { method: "POST" });
