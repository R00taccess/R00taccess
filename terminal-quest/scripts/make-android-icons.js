'use strict';
/*
 * Generates Android launcher icons (ic_launcher.png) for every density from
 * the same ">_" terminal design as the desktop icon. Pure Node, no deps.
 *
 *   node scripts/make-android-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DENSITIES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192
};

const CRC_TABLE = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makeIcon(SIZE) {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const i = (y * SIZE + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const m = Math.max(2, Math.round(SIZE * 0.047));
  const radius = Math.round(SIZE * 0.16);
  const inside = (x, y) => {
    const rx = Math.min(x - m, SIZE - 1 - m - x);
    const ry = Math.min(y - m, SIZE - 1 - m - y);
    if (rx < 0 || ry < 0) return false;
    const cx = x < radius + m ? radius + m : (x > SIZE - 1 - radius - m ? SIZE - 1 - radius - m : x);
    const cy = y < radius + m ? radius + m : (y > SIZE - 1 - radius - m ? SIZE - 1 - radius - m : y);
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!inside(x, y)) { set(x, y, 0, 0, 0, 0); continue; }
      if (y < SIZE * 0.17) set(x, y, 10, 26, 16, 255);
      else set(x, y, 4, 8, 6, 255);
    }
  }
  const edgeT = Math.max(1, Math.round(SIZE * 0.012));
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x - edgeT, y) || !inside(x + edgeT, y) || !inside(x, y - edgeT) || !inside(x, y + edgeT)) {
        set(x, y, 0, 255, 102, 255);
      }
    }
  }
  const G = (x, y, t) => {
    for (let dx = -t; dx <= t; dx++) for (let dy = -t; dy <= t; dy++) {
      if (dx * dx + dy * dy <= t * t) set(Math.round(x + dx), Math.round(y + dy), 0, 255, 102, 255);
    }
  };
  const u = SIZE / 256;
  const t1 = Math.max(1, Math.round(6 * u));
  for (let s = 0; s <= 46 * u; s++) { G(70 * u + s, 108 * u + s, t1); }
  for (let s = 0; s <= 46 * u; s++) { G(70 * u + s, 200 * u - s, t1); }
  const t2 = Math.max(1, Math.round(5 * u));
  for (let s = 0; s <= 70 * u; s++) { G(140 * u + s, 196 * u, t2); }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

const resDir = path.join(__dirname, '..', 'android-app', 'app', 'src', 'main', 'res');
for (const [dir, size] of Object.entries(DENSITIES)) {
  const out = path.join(resDir, dir);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'ic_launcher.png'), makeIcon(size));
  console.log(`wrote ${dir}/ic_launcher.png (${size}x${size})`);
}
