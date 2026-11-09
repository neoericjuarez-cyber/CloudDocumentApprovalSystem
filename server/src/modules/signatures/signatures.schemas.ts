import { HttpError } from "../../lib/errors";

export const MAX_SIGNATURE_BYTES = 150_000;
export const MAX_SIGNATURE_WIDTH = 1200;
export const MAX_SIGNATURE_HEIGHT = 600;

const DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Accepts ONLY a genuine, small PNG. The label on the data URL isn't trusted: the actual bytes must start
 * with the PNG signature and the header must describe a sensible size. SVG (which can contain script),
 * JPEG, GIF and anything else is refused. Returns the image as a data URL ready to store.
 */
export function parseSignatureImage(dataUrl: string): string {
  const match = DATA_URL.exec(dataUrl);
  if (!match) throw new HttpError(400, "The signature must be a PNG image");
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length > MAX_SIGNATURE_BYTES) throw new HttpError(400, "That signature image is too large. Try a simpler one");
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_MAGIC) || bytes.toString("ascii", 12, 16) !== "IHDR")
    throw new HttpError(400, "The signature must be a valid PNG image");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > MAX_SIGNATURE_WIDTH || height > MAX_SIGNATURE_HEIGHT)
    throw new HttpError(400, `The signature image must be at most ${MAX_SIGNATURE_WIDTH}×${MAX_SIGNATURE_HEIGHT} pixels`);
  return `data:image/png;base64,${match[1]}`;
}
