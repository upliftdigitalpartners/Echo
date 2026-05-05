// Generates square PNG app icons with no external deps.
// Dark background, amber circle in the middle (the "echo pin").
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";

const OUT_DIR = resolve(process.cwd(), "public");
mkdirSync(OUT_DIR, { recursive: true });

const BG = [10, 10, 10];      // zinc-950
const FG = [251, 191, 36];    // amber-400
const RING = [120, 53, 15];   // amber-900-ish

function makeIcon(size) {
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * 0.34;
  const rRing = size * 0.40;
  const rInner = size * 0.20;

  const px = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      let c = BG;
      if (d <= rInner) c = FG;
      else if (d <= rOuter) c = mix(FG, BG, (d - rInner) / (rOuter - rInner) * 0.85);
      else if (d <= rRing) c = mix(RING, BG, (d - rOuter) / (rRing - rOuter));
      const o = (y * size + x) * 3;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2];
    }
  }
  return encodePNG(px, size, size);
}

function mix(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] * (1 - t) + b[0] * t),
    Math.round(a[1] * (1 - t) + b[1] * t),
    Math.round(a[2] * (1 - t) + b[2] * t),
  ];
}

function encodePNG(rgb, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const idat = deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const td = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

for (const size of [192, 512]) {
  const path = resolve(OUT_DIR, `icon-${size}.png`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, makeIcon(size));
  console.log("wrote", path);
}
