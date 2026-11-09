// Makes a believable handwritten-looking signature PNG for the DUMMY approver accounts (seed + tests only).
// Real approvers draw or upload their own on the My E-Signature page. No dependencies: a tiny PNG encoder.
import { deflateSync } from "node:zlib";

const W = 320, H = 110;

const CRC_TABLE = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); }
  return t;
})();
const crc32 = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Small deterministic random numbers so each name always gets the same, distinct-looking signature.
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

export function makeSignaturePng(name: string): Buffer {
  const rand = rng(name);
  const px = Buffer.alloc(W * H * 4);                       // RGBA, fully transparent
  const dab = (cx: number, cy: number, r: number) => {      // one round, soft-edged ink dab
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const a = Math.max(0, Math.min(1, r + 0.5 - Math.hypot(x - cx, y - cy)));
      const i = (y * W + x) * 4, alpha = Math.round(a * 255);
      if (alpha > px[i + 3]) { px[i] = 27; px[i + 1] = 42; px[i + 2] = 100; px[i + 3] = alpha; }
    }
  };
  const loops = 3 + Math.floor(rand() * 3), waves = 5 + Math.floor(rand() * 4), p1 = rand() * 6.28, p2 = rand() * 6.28;
  for (let i = 0; i <= 2400; i++) {
    const t = i / 2400;
    const x = 24 + 270 * t + 24 * Math.sin(6.283 * loops * t + p1);
    const y = 52 + 30 * Math.sin(6.283 * waves * t / 2 + p2) * (1 - 0.35 * t) + 8 * Math.cos(6.283 * loops * t);
    dab(x, y, 1.7 + 0.5 * Math.sin(40 * t));
  }
  for (let i = 0; i <= 600; i++) { const t = i / 600; dab(34 + 250 * t, 96 - 10 * t + 3 * Math.sin(9 * t), 1.2); }   // underline flourish

  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;   // 8-bit RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export const makeSignatureDataUrl = (name: string) => `data:image/png;base64,${makeSignaturePng(name).toString("base64")}`;
