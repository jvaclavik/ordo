import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function inRoundRect(x, y, size, radius) {
  const pad = size * 0.08;
  const left = pad;
  const right = size - pad;
  const top = pad;
  const bottom = size - pad;
  if (x < left || x > right || y < top || y > bottom) return false;
  const corners = [
    [left + radius, top + radius],
    [right - radius, top + radius],
    [left + radius, bottom - radius],
    [right - radius, bottom - radius],
  ];
  const insideCore = x >= left + radius && x <= right - radius || y >= top + radius && y <= bottom - radius;
  if (insideCore) return true;
  return corners.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2);
}

function onCheck(x, y, size) {
  const ax = size * 0.3;
  const ay = size * 0.54;
  const bx = size * 0.45;
  const by = size * 0.7;
  const cx = size * 0.72;
  const cy = size * 0.36;
  const width = size * 0.055;
  return distanceToSegment(x, y, ax, ay, bx, by) < width || distanceToSegment(x, y, bx, by, cx, cy) < width;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / length));
  const x = x1 + t * dx;
  const y = y1 + t * dy;
  return Math.hypot(px - x, py - y);
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const radius = size * 0.22;
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const index = row + 1 + x * 4;
      if (!inRoundRect(x, y, size, radius)) {
        raw[index + 3] = 0;
        continue;
      }
      const mark = onCheck(x, y, size);
      raw[index] = mark ? 251 : 14;
      raw[index + 1] = mark ? 250 : 107;
      raw[index + 2] = mark ? 246 : 92;
      raw[index + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync("public/icon-192.png", png(192));
writeFileSync("public/icon-512.png", png(512));
