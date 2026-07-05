// Genera icone PWA (PNG) senza dipendenze esterne: sfondo scuro + monogramma "N" in verde menta.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const BG = [0x0d, 0x10, 0x17]; // #0D1017
const FG = [0x4a, 0xde, 0x9c]; // #4ADE9C

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// disegna la "N" come poligono pieno (due gambe verticali + diagonale), con margine
function isForeground(x, y, size) {
  const m = Math.round(size * 0.22); // margine
  const w = size - 2 * m;
  const strokeW = Math.round(w * 0.22);
  const lx = x - m, ly = y - m;
  if (lx < 0 || ly < 0 || lx >= w || ly >= w) return false;
  // gamba sinistra
  if (lx < strokeW) return true;
  // gamba destra
  if (lx >= w - strokeW) return true;
  // diagonale da alto-sinistra a basso-destra
  const t = lx / w; // 0..1
  const diagCenter = t * w;
  if (Math.abs(ly - diagCenter) < strokeW * 0.9) return true;
  return false;
}

function makeIcon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // no filter
    for (let x = 0; x < size; x++) {
      const fg = isForeground(x, y, size);
      const [r, g, b] = fg ? FG : BG;
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return png;
}

const outDir = path.join(__dirname, "..", "public", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), makeIcon(size));
}
console.log("Icone create in", outDir);
