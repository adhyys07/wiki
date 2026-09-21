/**
 * Image validation.
 *
 * Type is decided by MAGIC BYTES, never by the filename or the browser's
 * Content-Type — both are attacker-controlled. SVG is deliberately not
 * supported: it is an XML document that can carry <script>, and images are
 * served from our own origin, so an SVG upload would be stored XSS.
 */

export const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_DIMENSION = 6000; // guards decompression bombs

export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export interface ProbeResult {
  mime: ImageMime;
  width: number | null;
  height: number | null;
}

function isPng(b: Buffer) {
  return (
    b.length > 24 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  );
}

function isJpeg(b: Buffer) {
  return b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function isGif(b: Buffer) {
  return b.length > 10 && b.subarray(0, 4).toString("latin1") === "GIF8";
}

function isWebp(b: Buffer) {
  return (
    b.length > 16 &&
    b.subarray(0, 4).toString("latin1") === "RIFF" &&
    b.subarray(8, 12).toString("latin1") === "WEBP"
  );
}

function pngSize(b: Buffer) {
  // IHDR is always the first chunk: width/height are big-endian at 16 and 20.
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function gifSize(b: Buffer) {
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function webpSize(b: Buffer): { width: number; height: number } | null {
  const fmt = b.subarray(12, 16).toString("latin1");
  if (fmt === "VP8 " && b.length > 30) {
    return {
      width: b.readUInt16LE(26) & 0x3fff,
      height: b.readUInt16LE(28) & 0x3fff,
    };
  }
  if (fmt === "VP8L" && b.length > 25) {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fmt === "VP8X" && b.length > 30) {
    const w = b[24] | (b[25] << 8) | (b[26] << 16);
    const h = b[27] | (b[28] << 8) | (b[29] << 16);
    return { width: w + 1, height: h + 1 };
  }
  return null;
}

function jpegSize(b: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    // SOF0..SOF15, excluding DHT(c4), JPG(c8) and DAC(cc)
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    const len = b.readUInt16BE(i + 2);
    if (len <= 0) return null;
    i += 2 + len;
  }
  return null;
}

export function probeImage(
  bytes: Buffer,
): { ok: true; result: ProbeResult } | { ok: false; error: string } {
  if (bytes.length === 0) return { ok: false, error: "That file is empty." };
  if (bytes.length > MAX_BYTES) {
    return {
      ok: false,
      error: `Images must be under ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`,
    };
  }

  let mime: ImageMime;
  let size: { width: number; height: number } | null = null;

  if (isPng(bytes)) {
    mime = "image/png";
    size = pngSize(bytes);
  } else if (isJpeg(bytes)) {
    mime = "image/jpeg";
    size = jpegSize(bytes);
  } else if (isGif(bytes)) {
    mime = "image/gif";
    size = gifSize(bytes);
  } else if (isWebp(bytes)) {
    mime = "image/webp";
    size = webpSize(bytes);
  } else {
    return {
      ok: false,
      error: "Only PNG, JPEG, GIF and WebP images are accepted.",
    };
  }

  if (size && (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION)) {
    return {
      ok: false,
      error: `Images must be at most ${MAX_DIMENSION}px on each side.`,
    };
  }

  return {
    ok: true,
    result: { mime, width: size?.width ?? null, height: size?.height ?? null },
  };
}
