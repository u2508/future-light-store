#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const beforeDir = resolve(process.argv[2] || "");
const afterDir = resolve(process.argv[3] || "public/data");

function withoutGeneratedAt(value) {
  if (Array.isArray(value)) {
    return value.map(withoutGeneratedAt);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "generatedAt")
        .map(([key, entry]) => [key, withoutGeneratedAt(entry)]),
    );
  }

  return value;
}

async function readNormalized(directory, file) {
  try {
    const payload = JSON.parse(await readFile(join(directory, file), "utf8"));
    return JSON.stringify(withoutGeneratedAt(payload));
  } catch {
    return null;
  }
}

const files = new Set([
  ...(await readdir(beforeDir).catch(() => [])),
  ...(await readdir(afterDir).catch(() => [])),
]);
const jsonFiles = [...files].filter((file) => file.endsWith(".json")).sort();
const changedFiles = [];

for (const file of jsonFiles) {
  const [before, after] = await Promise.all([
    readNormalized(beforeDir, file),
    readNormalized(afterDir, file),
  ]);

  if (before !== after) {
    changedFiles.push(file);
  }
}

process.stdout.write(`changed=${changedFiles.length > 0}\n`);
process.stdout.write(`changedFiles=${changedFiles.join(",")}\n`);
