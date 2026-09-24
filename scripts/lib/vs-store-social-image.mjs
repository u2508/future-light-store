import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { deflateSync } from "node:zlib";

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeSlug(value) {
  return (
    normalizeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "vs-store-post"
  );
}

function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const typeBytes = Buffer.from(type, "ascii");
  const data = Buffer.concat([typeBytes, payload]);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  checksum.writeUInt32BE(crc32(data), 0);
  return Buffer.concat([length, data, checksum]);
}

export function createFallbackLogoPng() {
  const width = 256;
  const height = 256;
  const pixels = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = 8;
    pixels[offset + 1] = 20;
    pixels[offset + 2] = 45;
    pixels[offset + 3] = 255;
  }
  const setPixel = (x, y, color) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = (y * width + x) * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = color[3];
  };
  const blue = [23, 92, 211, 255];
  const gold = [214, 167, 44, 255];
  const white = [255, 255, 255, 255];
  const center = 128;
  const outerRadius = 119;
  const innerRadius = 109;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(x - center, y - center);
      if (distance <= outerRadius) setPixel(x, y, distance >= innerRadius ? gold : blue);
    }
  }
  const glyphs = {
    V: ["10001", "10001", "10001", "10001", "01010", "01010", "00100"],
    S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  };
  const drawGlyph = (glyph, startX, startY, scale) => {
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== "1") continue;
        for (let y = 0; y < scale; y += 1) {
          for (let x = 0; x < scale; x += 1)
            setPixel(startX + column * scale + x, startY + row * scale + y, white);
        }
      }
    }
  };
  drawGlyph(glyphs.V, 43, 75, 16);
  drawGlyph(glyphs.S, 131, 75, 16);
  for (let y = 0; y < 18; y += 1) {
    for (let x = 0; x < 18; x += 1) {
      if (Math.hypot(x - 9, y - 9) <= 9) setPixel(210 + x, 29 + y, gold);
    }
  }
  const scanlines = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (y * width + x) * 4;
      const targetOffset = rowOffset + 1 + x * 3;
      pixels.copy(scanlines, targetOffset, sourceOffset, sourceOffset + 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export async function ensureSocialLogo(config, assetDir) {
  const existingPath = resolve(config.rootDir, "output", "imagegen", "vs-store-logo.png");
  if (existsSync(existingPath)) return existingPath;
  const fallbackPath = resolve(assetDir, ".vs-store-logo-fallback.png");
  if (!existsSync(fallbackPath)) await writeFile(fallbackPath, createFallbackLogoPng());
  return fallbackPath;
}

async function downloadImage(url, outputPath, config) {
  if (!/^https?:\/\//i.test(String(url || "")))
    throw new Error("Social image URL must be an HTTP(S) URL.");
  let lastError;
  for (let attempt = 0; attempt < config.maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(config.requestTimeoutMs) });
      if (!response.ok) {
        const error = new Error(`Social image download failed with HTTP ${response.status}.`);
        error.retryable =
          response.status === 408 || response.status === 429 || response.status >= 500;
        throw error;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error("Social image download returned an empty file.");
      await writeFile(outputPath, bytes);
      return outputPath;
    } catch (error) {
      lastError = error;
      if (
        attempt >= config.maxAttempts - 1 ||
        !(
          error?.retryable ||
          /timeout|network|socket|dns|enotfound|eai_again/i.test(String(error?.message || error))
        )
      )
        throw error;
      const delayMs = Math.min(60_000, 750 * 2 ** attempt + Math.floor(Math.random() * 350));
      process.stdout.write(`Social image download retrying in ${Math.ceil(delayMs / 1000)}s.\n`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
    }
  }
  throw lastError || new Error("Social image download failed.");
}

export async function prepareImageGenReferences({
  config,
  content,
  runKey,
  sourceUrl = "",
  existingSourcePath = "",
}) {
  const assetDir = resolve(
    config.socialOutputDir || resolve(config.rootDir, "output", "social"),
    "assets",
    runKey,
  );
  await mkdir(assetDir, { recursive: true });
  const logoPath = await ensureSocialLogo(config, assetDir);
  if (content?.kind === "banner") return { assetDir, logoPath, sourcePath: null };

  const reusableSourcePath = String(existingSourcePath || "").trim();
  if (reusableSourcePath && existsSync(reusableSourcePath)) {
    return { assetDir, logoPath, sourcePath: reusableSourcePath };
  }
  if (!sourceUrl) throw new Error("Image Gen requires a verified source image for this post.");
  const contentSlug = safeSlug(
    content?.product?.title || content?.collection?.title || content?.kind || "social-post",
  );
  let sourceExtension = ".jpg";
  try {
    const pathnameExtension = extname(new URL(sourceUrl).pathname).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp"].includes(pathnameExtension))
      sourceExtension = pathnameExtension;
  } catch {
    // Keep the broadly supported JPEG extension when a CDN URL has no pathname.
  }
  const sourcePath = resolve(assetDir, `imagegen-source-${contentSlug}${sourceExtension}`);
  if (!existsSync(sourcePath)) await downloadImage(sourceUrl, sourcePath, config);
  return { assetDir, logoPath, sourcePath };
}
