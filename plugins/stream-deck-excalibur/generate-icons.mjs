/**
 * Generate placeholder PNG icons for the Stream Deck plugin.
 * Creates solid-color icons with a simple "E" letter rendered as pixels.
 * Replace these with proper branded icons before distribution.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { deflateSync } from 'zlib';

const IMGS_DIR = 'com.mayday.excalibur.sdPlugin/imgs';

// Minimal PNG generator for solid-color icons
function createPng(width, height, r, g, b, a = 255) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Image data: each row has a filter byte (0) + RGBA pixels
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const offset = y * rowSize;
    rawData[offset] = 0; // no filter
    for (let x = 0; x < width; x++) {
      const px = offset + 1 + x * 4;
      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
      rawData[px + 3] = a;
    }
  }

  const compressed = deflateSync(rawData);

  // Build chunks
  const chunks = [
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ];

  return Buffer.concat([signature, ...chunks]);
}

function makeChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBuffer, data]);
  const crc = crc32(body);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([length, body, crcBuffer]);
}

// CRC32 for PNG chunks
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Generate icons
const icons = [
  { name: 'plugin-icon.png', size: 72 },
  { name: 'plugin-icon@2x.png', size: 144 },
  { name: 'category-icon.png', size: 28 },
  { name: 'category-icon@2x.png', size: 56 },
  { name: 'action-icon.png', size: 20 },
  { name: 'action-icon@2x.png', size: 40 },
];

mkdirSync(IMGS_DIR, { recursive: true });

for (const icon of icons) {
  // Dark blue/purple — Excalibur themed
  const png = createPng(icon.size, icon.size, 88, 66, 186);
  const outPath = join(IMGS_DIR, icon.name);
  writeFileSync(outPath, png);
  console.log(`Generated ${outPath} (${icon.size}x${icon.size})`);
}

console.log('Icon generation complete.');
