#!/usr/bin/env node

import { chmod, lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const envPath = resolve(rootDir, ".env.vs-store-social.local");
const envKey = "FUTURE_LIGHT_META_PAGE_ACCESS_TOKEN";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main() {
  const token = await readStdin();
  if (token.length < 40 || /\s|[\u0000-\u001f\u007f]/.test(token)) {
    throw new Error("Expected one Meta access token on stdin; nothing was stored.");
  }

  const metadata = await lstat(envPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("The ignored social environment path is not a regular file.");
  }

  const current = await readFile(envPath, "utf8");
  const lines = current.split(/\r?\n/);
  const keyPattern = /^\s*(?:export\s+)?FUTURE_LIGHT_META_PAGE_ACCESS_TOKEN\s*=/;
  const matches = lines.reduce((indices, line, index) => {
    if (keyPattern.test(line)) indices.push(index);
    return indices;
  }, []);
  if (matches.length > 1) {
    throw new Error("Duplicate Meta Page token settings found; nothing was stored.");
  }

  const assignment = `${envKey}=${token}`;
  if (matches.length === 1) lines[matches[0]] = assignment;
  else lines.push(assignment);
  const updated = `${lines.join("\n").replace(/\n+$/, "")}\n`;
  const tempPath = `${envPath}.tmp-${process.pid}`;

  try {
    await writeFile(tempPath, updated, { flag: "wx", mode: 0o600 });
    await chmod(tempPath, 0o600);
    await rename(tempPath, envPath);
    await chmod(envPath, 0o600);

    const persisted = await readFile(envPath, "utf8");
    if (!persisted.split(/\r?\n/).includes(assignment)) {
      throw new Error("Token readback verification failed; value was not displayed.");
    }
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }

  process.stdout.write("Meta Page token stored in the ignored local social config with owner-only permissions (0600); value redacted.\n");
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
