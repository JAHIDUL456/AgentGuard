const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// PNG CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const toCrc = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(toCrc), 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function generatePng(width, height) {
  // Raw scanlines: each line begins with filter byte 0
  const scanlineWidth = width * 4;
  const rawData = Buffer.alloc(height * (1 + scanlineWidth));

  // Render a sleek shield icon
  // Center: (64, 64)
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + scanlineWidth);
    rawData[rowOffset] = 0; // Filter byte 0 (None)

    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;

      // Normalized coordinates [-1, 1]
      const nx = (x - width / 2) / (width / 2);
      const ny = (y - height / 2) / (height / 2);

      // Rounded rectangle background (#0f172a - dark slate)
      const cornerR = 0.22;
      const qx = Math.max(0, Math.abs(nx) - (1 - cornerR));
      const qy = Math.max(0, Math.abs(ny) - (1 - cornerR));
      const distToCorner = Math.hypot(qx, qy);
      const inCard = (Math.abs(nx) <= 1 && Math.abs(ny) <= 1 && distToCorner <= cornerR);

      if (!inCard) {
        // Transparent outside
        rawData[pixelOffset] = 0;
        rawData[pixelOffset + 1] = 0;
        rawData[pixelOffset + 2] = 0;
        rawData[pixelOffset + 3] = 0;
        continue;
      }

      // Card background: deep blue-gray gradient
      let r = 15;
      let g = 23;
      let b = 42;
      let a = 255;

      // Shield geometry check:
      // Coordinates normalized to shield area: cx=64, cy=64, w=76, h=88
      const sx = (x - 64) / 36;
      const sy = (y - 58) / 44;

      // Shield profile:
      // Top line at sy = -0.7 to sy = -0.5 (pointed at top center sx=0, sy=-0.8)
      // Top boundary: sy >= -0.8 + 0.3 * Math.abs(sx)
      // Side boundary: Math.abs(sx) <= 0.85
      // Bottom boundary: sy <= 0.9 - 0.75 * Math.pow(Math.abs(sx), 1.4)
      const inTop = sy >= (-0.75 + 0.22 * Math.abs(sx));
      const inSide = Math.abs(sx) <= 0.85;
      const inBottom = sy <= (0.95 - 0.8 * Math.pow(Math.min(1, Math.abs(sx)), 1.5));
      const inShield = inTop && inSide && inBottom;

      // Inner shield profile (for stroke)
      const isx = (x - 64) / 30;
      const isy = (y - 59) / 38;
      const inInnerShield = (isy >= (-0.75 + 0.22 * Math.abs(isx))) &&
                            (Math.abs(isx) <= 0.85) &&
                            (isy <= (0.95 - 0.8 * Math.pow(Math.min(1, Math.abs(isx)), 1.5)));

      // Inner icon elements:
      // Vertical line: x in [61, 67], y in [46, 62]
      const inVertBar = (Math.abs(x - 64) <= 2.5 && y >= 46 && y <= 62);
      // Center circle: cx=64, cy=74, r=6
      const inCircle = Math.hypot(x - 64, y - 74) <= 5.5;
      // V-shaped chevron: abs(x - 64) <= 12, abs((y - 62) - 0.6 * abs(x - 64)) <= 2.5
      const chevronDist = Math.abs((y - 60) - 0.5 * Math.abs(x - 64));
      const inChevron = chevronDist <= 2.2 && Math.abs(x - 64) >= 3 && Math.abs(x - 64) <= 14 && y >= 58 && y <= 68;

      if (inShield && !inInnerShield) {
        // Outer shield border - Cyan / Blue glow
        const borderT = (y - 20) / 80;
        r = Math.round(56 + (14 - 56) * borderT);
        g = Math.round(189 + (165 - 189) * borderT);
        b = Math.round(248 + (233 - 248) * borderT);
      } else if (inVertBar || inCircle || inChevron) {
        // Inner guard symbol - Bright cyan
        r = 56;
        g = 189;
        b = 248;
      } else if (inInnerShield) {
        // Inner shield fill - Dark navy blue gradient
        r = 30;
        g = 41;
        b = 59;
      }

      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  // PNG Signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk: width(4), height(4), bitDepth(1)=8, colorType(1)=6(RGBA), comp(1)=0, filt(1)=0, inter(1)=0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const ihdrChunk = createChunk('IHDR', ihdr);

  // IDAT chunk
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const iconBuffer = generatePng(128, 128);
const outDir = path.join(__dirname, '..', 'resources', 'icons');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}
const outPath = path.join(outDir, 'agentguard-icon.png');
fs.writeFileSync(outPath, iconBuffer);
console.log(`Generated icon at ${outPath} (${iconBuffer.length} bytes)`);

