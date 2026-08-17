#!/usr/bin/env node

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");
const label = "com.salt.online-store.release";
const homeDir = homedir();
const launchAgentsDir = resolve(homeDir, "Library", "LaunchAgents");
const plistPath = resolve(launchAgentsDir, `${label}.plist`);
const outputDir = resolve(rootDir, "output");
const stdoutPath = resolve(outputDir, "scheduled-release.log");
const stderrPath = resolve(outputDir, "scheduled-release.error.log");
const uid = String(process.getuid?.() || "");

if (process.platform !== "darwin") {
  throw new Error("The daily background release installer requires macOS launchd.");
}
if (!uid) throw new Error("Could not determine the current macOS user id.");

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlString(value) {
  return `<string>${xmlEscape(value)}</string>`;
}

function xmlEnvironment(environment) {
  return Object.entries(environment)
    .map(([key, value]) => `<key>${xmlEscape(key)}</key>\n${xmlString(value)}`)
    .join("\n");
}

async function findExecutable(name) {
  const { stdout } = await execFileAsync("/usr/bin/which", [name]);
  const path = stdout.trim();
  if (!path) throw new Error(`${name} executable was not found.`);
  return path;
}

async function main() {
  const npmPath = await findExecutable("npm");
  const pathValue = [
    resolve(homeDir, ".npm-global", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/usr/bin",
    "/bin",
  ].join(":");
  const environment = {
    HOME: homeDir,
    PATH: pathValue,
    SALT_RELEASE_SKIP_MOBILE: "1",
    SALT_SHOPIFY_SYNC_ACTIVE_CATALOG: "1",
    SALT_ALLOW_MISSING_CANONICAL_COLLECTIONS: "hats",
    SALT_REQUIRE_KNOWLEDGE_MODEL: "1",
    SALT_CATALOG_BATCH_SIZE: "50",
    SALT_CATALOG_TAXONOMY_APPROVED: "1",
    SALT_CATALOG_TAXONOMY_APPROVAL_ID: "salt-full-catalog-release-2026-08-06-approved",
    SALT_CATALOG_COLLECTIONS_APPROVED: "1",
    SALT_CATALOG_COLLECTIONS_APPROVAL_ID: "salt-full-catalog-collections-2026-08-10-hats-approved",
  };
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${xmlString(label)}
  <key>ProgramArguments</key>
  <array>
    ${xmlString(npmPath)}
    ${xmlString("run")}
    ${xmlString("release:daily")}
  </array>
  <key>WorkingDirectory</key>
  ${xmlString(rootDir)}
  <key>EnvironmentVariables</key>
  <dict>
    ${xmlEnvironment(environment)}
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>23</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>ProcessType</key>
  ${xmlString("Background")}
  <key>LowPriorityIO</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>3600</integer>
  <key>StandardOutPath</key>
  ${xmlString(stdoutPath)}
  <key>StandardErrorPath</key>
  ${xmlString(stderrPath)}
</dict>
</plist>
`;

  await mkdir(launchAgentsDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await writeFile(plistPath, plist, { encoding: "utf8", mode: 0o600 });

  try {
    await execFileAsync("/bin/launchctl", ["bootout", `gui/${uid}/${label}`]);
  } catch {
    // The first install has no loaded service to remove.
  }
  await execFileAsync("/bin/launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
  await execFileAsync("/bin/launchctl", ["print", `gui/${uid}/${label}`]);

  process.stdout.write(`Installed ${label}.\n`);
  process.stdout.write("Schedule: every day at 23:00 local macOS time.\n");
  process.stdout.write(`Plist: ${plistPath}\n`);
  process.stdout.write(`Logs: ${stdoutPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
