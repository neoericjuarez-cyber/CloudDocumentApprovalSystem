import { api } from "./client";

export type SavedSignature = { imageData: string; updatedAt: string };

export const getSignature = () => api<{ signature: SavedSignature | null }>("/signature").then(r => r.signature);
export const saveSignature = (imageData: string) =>
  api<{ signature: SavedSignature }>("/signature", { method: "PUT", body: { imageData } }).then(r => r.signature);
export const deleteSignature = () => api<{ ok: true }>("/signature", { method: "DELETE" });
