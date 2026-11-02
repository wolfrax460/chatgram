/**
 * Minimal, dependency-free QR Code encoder for the landing page.
 *
 * Only what the download card needs: byte mode, error-correction level M,
 * versions 1-5 (up to 84-byte URLs), mask pattern 0. The QR target is the
 * Android APK URL derived from SITE_URL, so the code is generated during the
 * landing build instead of being a checked-in image that would go stale when the
 * site moves to a new host.
 *
 * Renderer output mirrors the old checked-in `apk-qr.svg`: one white background
 * rect and one path made of horizontal dark runs, with `shape-rendering:
 * crispEdges`.
 */

/* Total/data codewords and EC layout for error-correction level M. */
const VERSIONS = [
  { version: 1, size: 21, dataCodewords: 16, ecPerBlock: 10, blocks: 1 },
  { version: 2, size: 25, dataCodewords: 28, ecPerBlock: 16, blocks: 1 },
  { version: 3, size: 29, dataCodewords: 44, ecPerBlock: 26, blocks: 1 },
  { version: 4, size: 33, dataCodewords: 64, ecPerBlock: 18, blocks: 2 },
  { version: 5, size: 37, dataCodewords: 86, ecPerBlock: 24, blocks: 2 },
];

const EC_LEVEL_M = 0; // 2-bit indicator for level M
const MASK = 0;

/* GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d). */
const EXP = new Uint8Array(512);
const LOG = new Int16Array(256);
(function initGalois() {
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = value;
    LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

function gfMultiply(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMultiply(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data, ecCount) {
  const generator = rsGenerator(ecCount);
  const remainder = new Array(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift();
    remainder.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecCount; i += 1) remainder[i] ^= gfMultiply(generator[i + 1], factor);
    }
  }
  return remainder;
}

function pickVersion(byteLength) {
  const neededBits = 4 + 8 + byteLength * 8;
  for (const version of VERSIONS) {
    if (neededBits <= version.dataCodewords * 8) return version;
  }
  throw new Error(
    `QR payload too long (${byteLength} bytes); this encoder supports up to ${VERSIONS[VERSIONS.length - 1].dataCodewords - 2} bytes`,
  );
}

function encodeCodewords(bytes, version) {
  const dataBits = [];
  const pushBits = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) dataBits.push((value >> i) & 1);
  };
  pushBits(0b0100, 4); // byte mode
  pushBits(bytes.length, 8);
  for (const byte of bytes) pushBits(byte, 8);
  const capacityBits = version.dataCodewords * 8;
  for (let i = 0; i < 4 && dataBits.length < capacityBits; i += 1) dataBits.push(0);
  while (dataBits.length % 8 !== 0) dataBits.push(0);
  const dataCodewords = [];
  for (let i = 0; i < dataBits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | dataBits[i + j];
    dataCodewords.push(byte);
  }
  const padBytes = [0xec, 0x11];
  let padIndex = 0;
  while (dataCodewords.length < version.dataCodewords) {
    dataCodewords.push(padBytes[padIndex % 2]);
    padIndex += 1;
  }

  const blockLength = version.dataCodewords / version.blocks;
  const dataBlocks = [];
  const ecBlocks = [];
  for (let b = 0; b < version.blocks; b += 1) {
    const block = dataCodewords.slice(b * blockLength, (b + 1) * blockLength);
    dataBlocks.push(block);
    ecBlocks.push(rsRemainder(block, version.ecPerBlock));
  }

  const codewords = [];
  for (let i = 0; i < blockLength; i += 1) {
    for (let b = 0; b < version.blocks; b += 1) codewords.push(dataBlocks[b][i]);
  }
  for (let i = 0; i < version.ecPerBlock; i += 1) {
    for (let b = 0; b < version.blocks; b += 1) codewords.push(ecBlocks[b][i]);
  }
  return codewords;
}

function bchFormat(data) {
  let value = data << 10;
  const bitLength = (number) => {
    let length = 0;
    while (number !== 0) {
      length += 1;
      number >>>= 1;
    }
    return length;
  };
  while (bitLength(value) >= 11) {
    value ^= 0x537 << (bitLength(value) - 11);
  }
  return ((data << 10) | value) ^ 0x5412;
}

function buildMatrix(bytes) {
  const version = pickVersion(bytes.length);
  const size = version.size;
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFunction = (row, col, dark) => {
    if (row < 0 || col < 0 || row >= size || col >= size) return;
    modules[row][col] = dark;
    isFunction[row][col] = true;
  };

  const placeFinder = (row, col) => {
    for (let dr = -1; dr <= 7; dr += 1) {
      for (let dc = -1; dc <= 7; dc += 1) {
        const rr = row + dr;
        const cc = col + dc;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const inFinder = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const dark =
          inFinder && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        setFunction(rr, cc, dark);
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i += 1) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }

  if (version.version >= 2) {
    const center = size - 7;
    for (let dr = -2; dr <= 2; dr += 1) {
      for (let dc = -2; dc <= 2; dc += 1) {
        const dark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
        setFunction(center + dr, center + dc, dark);
      }
    }
  }

  /* Format information (M + mask 0) in both copies; also reserves the modules. */
  const formatBits = bchFormat((EC_LEVEL_M << 3) | MASK);
  for (let i = 0; i < 15; i += 1) {
    const dark = ((formatBits >> i) & 1) === 1;
    if (i < 6) setFunction(i, 8, dark);
    else if (i < 8) setFunction(i + 1, 8, dark);
    else setFunction(size - 15 + i, 8, dark);

    if (i < 8) setFunction(8, size - i - 1, dark);
    else if (i < 9) setFunction(8, 15 - i - 1 + 1, dark);
    else setFunction(8, 15 - i - 1, dark);
  }
  setFunction(size - 8, 8, true); // dark module

  /* Data placement: two-column zigzag, right to left, skipping the timing column. */
  const codewords = encodeCodewords(bytes, version);
  let bitIndex = 7;
  let byteIndex = 0;
  let direction = -1;
  let row = size - 1;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (;;) {
      for (let c = 0; c < 2; c += 1) {
        const rr = row;
        const cc = col - c;
        if (isFunction[rr][cc]) continue;
        let dark = false;
        if (byteIndex < codewords.length) dark = ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
        if ((rr + cc) % 2 === 0) dark = !dark; // mask pattern 0
        modules[rr][cc] = dark;
        bitIndex -= 1;
        if (bitIndex === -1) {
          byteIndex += 1;
          bitIndex = 7;
        }
      }
      row += direction;
      if (row < 0 || row >= size) {
        row -= direction;
        direction = -direction;
        break;
      }
    }
  }

  return modules.map((line) => line.map(Boolean));
}

/** Build the boolean QR matrix for `text` (rows of true = dark). */
export function qrMatrix(text) {
  return buildMatrix([...Buffer.from(text, 'utf8')]);
}

/** Render a QR code for `text` as an SVG string (module coordinates, 6px/module). */
export function qrSvg(text, { pixelPerModule = 6, margin = 1, dark = '#0b141a', light = '#ffffff' } = {}) {
  const matrix = qrMatrix(text);
  const size = matrix.length;
  const moduleCount = size + margin * 2;
  const dimension = moduleCount * pixelPerModule;
  let path = '';
  for (let row = 0; row < size; row += 1) {
    let col = 0;
    while (col < size) {
      if (!matrix[row][col]) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < size && matrix[row][col]) col += 1;
      path += `M${start + margin} ${row + margin + 0.5}h${col - start}`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" viewBox="0 0 ${moduleCount} ${moduleCount}" shape-rendering="crispEdges"><path fill="${light}" d="M0 0h${moduleCount}v${moduleCount}H0z"/><path stroke="${dark}" d="${path}"/></svg>\n`;
}
