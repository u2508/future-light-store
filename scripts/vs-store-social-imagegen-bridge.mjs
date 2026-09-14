#!/usr/bin/env node

import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  readImageGenRequest,
  socialPaths,
  writeImageGenResult,
} from "./lib/vs-store-social-state.mjs";

const rootDir = resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const args = { show: false, writeResult: false };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--show") args.show = true;
    else if (token === "--write-result") args.writeResult = true;
    else if (token === "--run-key") args.runKey = argv[++index];
    else if (token === "--fingerprint") args.fingerprint = argv[++index];
    else if (token === "--image-path") args.imagePath = argv[++index];
    else if (token === "--mode") args.mode = argv[++index];
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

async function showRequest() {
  const request = await readImageGenRequest(rootDir);
  if (!request)
    throw new Error(`No Image Gen request exists at ${socialPaths(rootDir).imageGenRequest}.`);
  process.stdout.write(`${JSON.stringify(request, null, 2)}\n`);
}

async function writeResult(args) {
  if (!args.runKey || !args.fingerprint || !args.imagePath) {
    throw new Error("--write-result requires --run-key, --fingerprint, and --image-path.");
  }
  const request = await readImageGenRequest(rootDir);
  if (!request) throw new Error("No pending Image Gen request exists.");
  if (request.runKey !== args.runKey || request.fingerprint !== args.fingerprint) {
    throw new Error("Image Gen result does not match the pending request fingerprint.");
  }
  const imagePath = resolve(args.imagePath);
  const socialRoot = resolve(rootDir, "output", "social");
  if (!imagePath.startsWith(`${socialRoot}/`)) {
    throw new Error("Image Gen results must be copied into output/social before recording them.");
  }
  if (!/\.(?:png|jpe?g|webp)$/i.test(imagePath)) {
    throw new Error("Image Gen result must be a PNG, JPEG, or WebP file.");
  }
  if (resolve(request.outputPath || "") !== imagePath) {
    throw new Error("Image Gen result path must match the pending request outputPath.");
  }
  if (!existsSync(imagePath)) throw new Error(`Image Gen result does not exist: ${imagePath}`);
  const imageStats = await stat(imagePath);
  if (!imageStats.isFile() || imageStats.size < 512)
    throw new Error("Image Gen result is unexpectedly small or is not a file.");

  await writeImageGenResult(rootDir, {
    runKey: args.runKey,
    fingerprint: args.fingerprint,
    image: {
      verified: true,
      path: imagePath,
      mode: args.mode || "imagegen",
      bytes: imageStats.size,
    },
  });
  process.stdout.write(
    `Image Gen result saved at ${socialPaths(rootDir).imageGenResult}. Run npm run social:daily -- --resume-imagegen.\n`,
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.show) return showRequest();
  if (args.writeResult) return writeResult(args);
  throw new Error("Use --show or --write-result.");
}

main().catch((error) => {
  process.stderr.write(`VS Store Image Gen bridge failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
