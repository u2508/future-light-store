#!/usr/bin/env node

import { pathToFileURL } from "node:url";

/**
 * Fail-closed public entrypoint for the Future Light release.
 *
 * Production Shopify handlers are intentionally not dispatched here until
 * target, snapshot, approval, copy-preservation, and live-readback wiring is
 * complete. In particular, this command must never fall through to the
 * historical shared/SALT-configured release runner.
 */

const RESUME_VALUES = new Set(["1", "true", "yes", "on"]);
const FRESH_VALUES = new Set(["", "0", "false", "no", "off"]);

export function resolveFutureLightReleaseMode(args = [], env = {}) {
  if (!Array.isArray(args)) throw new TypeError("release args must be an array");
  const normalized = args.filter((arg) => arg !== "--");
  const resumeFlags = normalized.filter((arg) => arg === "--resume");
  const unknown = normalized.filter((arg) => arg !== "--resume");
  if (unknown.length) {
    throw new Error(`Unsupported release argument: ${unknown[0]}`);
  }
  if (resumeFlags.length > 1) throw new Error("--resume may be specified only once");

  const npmResume = String(env.npm_config_resume ?? env.NPM_CONFIG_RESUME ?? "")
    .trim()
    .toLowerCase();
  if (!FRESH_VALUES.has(npmResume) && !RESUME_VALUES.has(npmResume)) {
    throw new Error("npm resume mode must be a recognized true/false value");
  }
  return resumeFlags.length === 1 || RESUME_VALUES.has(npmResume) ? "resume" : "fresh";
}

export function runFutureLightReleaseCommand({
  args = process.argv.slice(2),
  env = process.env,
  stderr = process.stderr,
} = {}) {
  const mode = resolveFutureLightReleaseMode(args, env);
  stderr.write(
    [
      `Future Light release ${mode} is blocked: the guarded production Shopify handlers are not yet wired.`,
      "No Shopify request or mutation was made.",
      "The legacy release path is deliberately disabled here; a fresh release must first verify the exact Shopify target, then read a complete approved snapshot, and preserve approved accurate titles and descriptions byte-for-byte.",
    ].join("\n") + "\n",
  );
  return { mode, exitCode: 78 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = runFutureLightReleaseCommand().exitCode;
  } catch (error) {
    process.stderr.write(`Future Light release command rejected: ${String(error.message || error)}\n`);
    process.exitCode = 64;
  }
}
