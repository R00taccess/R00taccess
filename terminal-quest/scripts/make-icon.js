'use strict';
/*
 * Generates assets/icon.png (256x256) and assets/icon.ico for Terminal Quest.
 * Pure Node (uses zlib) — no image libraries required. The icon is a stylised
 * green terminal prompt ">_" on a black rounded panel.
 *
 *   node scripts/make-icon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

function makePixels() {
  const px = Buffer.alloc(SIZE * SIZE * 4); // RGBA
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const i = (y * SIZE + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const radius = 40;
  const inside = (x, y) => {
    // rounded rectangle mask with margin 12
    const m = 12;
    const rx = Math.min(x - m, SIZE - 1 - m - x);
    const ry = Math.min(y - m, SIZE - 1 - m - y);
    if (rx < 0 || ry < 0) return false;
    // corners
    const cornerX = x < radius + m ? radius + m : (x > SIZE - 1 - radius - m ? SIZE - 1 - radius - m : x);
    const cornerY = y < radius + m ? radius + m : (y > SIZE - 1 - radius - m ? SIZE - 1 - radius - m : y);
    const dx = x - cornerX, dy = y - cornerY;
    return dx * dx + dy * dy <= radius * radius;
  };

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!inside(x, y)) { set(x, y, 0, 0, 0, 0); continue; }
      // panel: near-black with faint green tint + top title bar
      if (y < 44) set(x, y, 10, 26, 16, 255);       // title bar
      else set(x, y, 4, 8, 6, 255);                  // screen
    }
  }
  // green glow border
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 3, y) || !inside(x + 3, y) || !inside(x, y - 3) || !inside(x, y + 3);
      if (edge) set(x, y, 0, 255, 102, 255);
    }
  }
  // draw ">_" prompt using thick strokes
  const G = (x, y, t = 8) => { for (let dx = -t; dx <= t; dx++) for (let dy = -t; dy <= t; dy++) if (dx*dx+dy*dy<=t*t) set(x+dx, y+dy, 0, 255, 102, 255); };
  // ">" chevron
  for (let s = 0; s <= 46; s++) { G(70 + s, 108 + s, 6); }
  for (let s = 0; s <= 46; s++) { G(70 + s, 200 - s, 6); }
  // "_" underscore cursor
  for (let s = 0; s <= 70; s++) { G(140 + s, 196, 5); }
  return px;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

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

function buildPNG(px) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 6; // bit depth 8, RGBA
  // add filter byte 0 per row
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function buildICO(png) {
  // ICO with a single 256x256 PNG-compressed image (Vista+).
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0; entry[1] = 0; // 0 => 256
  entry[2] = 0; entry[3] = 0;
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([header, entry, png]);
}

const px = makePixels();
const png = buildPNG(px);
const ico = buildICO(png);
const assets = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assets, { recursive: true });
fs.writeFileSync(path.join(assets, 'icon.png'), png);
fs.writeFileSync(path.join(assets, 'icon.ico'), ico);
console.log(`Wrote assets/icon.png (${png.length} bytes) and assets/icon.ico (${ico.length} bytes).`);
