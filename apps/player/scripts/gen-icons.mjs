// Generates the PWA PNG icons (same design as public/icon.svg) with no dependencies.
// Usage: node scripts/gen-icons.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BG = [0x07, 0x09, 0x0d];
const VOLT = [0xd4, 0xff, 0x3a];
const INK = [0x14, 0x1a, 0x05];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x / size, y / size);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
/** Design in 512 units; `scale` shrinks the volt tile toward the center (maskable safe zone). */
function design(scale) {
  const s = (v) => 256 + (v - 256) * scale;
  return (u, v) => {
    const x = u * 512;
    const y = v * 512;
    const bars = [
      [152, 136, 208, 376],
      [304, 136, 360, 376],
      [152, 228, 360, 284],
    ];
    for (const [a, b, c, d] of bars) if (inRoundRect(x, y, s(a), s(b), s(c), s(d), 10 * scale)) return INK;
    if (inRoundRect(x, y, s(64), s(64), s(448), s(448), 88 * scale)) return VOLT;
    return BG;
  };
}

writeFileSync(join(OUT, 'icon-192.png'), png(192, design(1)));
writeFileSync(join(OUT, 'icon-512.png'), png(512, design(1)));
writeFileSync(join(OUT, 'apple-touch-icon.png'), png(180, design(1)));
writeFileSync(join(OUT, 'icon-maskable-512.png'), png(512, design(0.72)));
console.log('icons written to', OUT);
