import { query } from "../../lib/db";
import { parseSignatureImage } from "./signatures.schemas";

export async function getSignature(userId: string) {
  const { rows } = await query("SELECT image_data, updated_at FROM signatures WHERE user_id = $1", [userId]);
  return rows[0] ? { imageData: rows[0].image_data as string, updatedAt: (rows[0].updated_at as Date).toISOString() } : null;
}

export async function saveSignature(userId: string, imageData: string) {
  const clean = parseSignatureImage(imageData);
  await query(
    `INSERT INTO signatures (user_id, image_data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET image_data = EXCLUDED.image_data, updated_at = now()`, [userId, clean]);
  return (await getSignature(userId))!;
}

export async function deleteSignature(userId: string) {
  await query("DELETE FROM signatures WHERE user_id = $1", [userId]);
}
