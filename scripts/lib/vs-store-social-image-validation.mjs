import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

function readJpegDimensions(bytes) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xc3;
    if (isStartOfFrame && segmentLength >= 7) {
      return {
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function readWebpDimensions(bytes) {
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF") return null;
  const kind = bytes.toString("ascii", 12, 16);
  if (kind === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    };
  }
  if (kind === "VP8L" && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (kind === "VP8 ") {
    const frame = bytes.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
    if (frame >= 0 && frame + 7 < bytes.length) {
      return { width: bytes.readUInt16LE(frame + 3), height: bytes.readUInt16LE(frame + 5) };
    }
  }
  return null;
}

function readPngInfo(bytes) {
  if (
    bytes.length < 26 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const colorType = bytes[25];
  let hasTransparency = colorType === 4 || colorType === 6;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const chunkLength = bytes.readUInt32BE(offset);
    const chunkType = bytes.toString("ascii", offset + 4, offset + 8);
    if (chunkType === "tRNS") hasTransparency = true;
    offset += chunkLength + 12;
    if (chunkType === "IEND") break;
  }
  return { width, height, hasTransparency };
}

export async function inspectSocialImage(imagePath, { minimumBytes = 512 } = {}) {
  const filePath = String(imagePath || "");
  const fileStats = await stat(filePath);
  if (!fileStats.isFile() || fileStats.size < minimumBytes)
    throw new Error("Image file is unexpectedly small or is not a regular file.");
  const bytes = await readFile(filePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let mimeType = "";
  let dimensions = null;
  let hasTransparency = false;
  const png = readPngInfo(bytes);
  if (png) {
    mimeType = "image/png";
    dimensions = { width: png.width, height: png.height };
    hasTransparency = png.hasTransparency;
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    mimeType = "image/jpeg";
    dimensions = readJpegDimensions(bytes);
  } else if (bytes.length >= 16 && bytes.toString("ascii", 0, 4) === "RIFF") {
    mimeType = "image/webp";
    dimensions = readWebpDimensions(bytes);
    const webpKind = bytes.toString("ascii", 12, 16);
    hasTransparency = webpKind === "VP8L" || (webpKind === "VP8X" && (bytes[20] & 0x10) !== 0);
  }
  if (!mimeType || !dimensions?.width || !dimensions?.height)
    throw new Error("Image file is not a decoded PNG, JPEG, or WebP with valid dimensions.");
  if (dimensions.width !== dimensions.height)
    throw new Error("Social images must be square with a 1:1 aspect ratio.");
  if (hasTransparency)
    throw new Error("Social images must be fully opaque with no transparent pixels.");
  return {
    path: filePath,
    bytes: fileStats.size,
    sha256,
    mimeType,
    width: dimensions.width,
    height: dimensions.height,
    square: true,
    opaque: true,
  };
}
