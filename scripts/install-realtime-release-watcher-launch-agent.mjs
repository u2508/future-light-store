#!/usr/bin/env node

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = resolve(import.meta.dirname, "..");
const label = "com.salt.online-store.release-watcher";
const legacyLabel = "com.salt.online-store.release";
const homeDir = homedir();
const launchAgentsDir = resolve(homeDir, "Library", "LaunchAgents");
const plistPath = resolve(launchAgentsDir, `${label}.plist`);
const outputDir = resolve(rootDir, "output");
const stdoutPath = resolve(outputDir, "realtime-release-watcher.stdout.log");
const stderrPath = resolve(outputDir, "realtime-release-watcher.stderr.log");
const uid = String(process.getuid?.() || "");

if (process.platform !== "darwin") {
  throw new Error("The realtime release watcher installer requires macOS launchd.");
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

async function unload(serviceLabel) {
  try {
    await execFileAsync("/bin/launchctl", ["bootout", `gui/${uid}/${serviceLabel}`]);
  } catch {
    // The service may not be installed yet.
  }
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
    SALT_RELEASE_WATCHER_POLL_MS: "300000",
    SALT_RELEASE_WATCHER_STALE_MS: "900000",
    SALT_RELEASE_WATCHER_MAX_RETRY_MS: "3600000",
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
    ${xmlString("release:watch")}
  </array>
  <key>WorkingDirectory</key>
  ${xmlString(rootDir)}
  <key>EnvironmentVariables</key>
  <dict>
    ${xmlEnvironment(environment)}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  ${xmlString("Background")}
  <key>LowPriorityIO</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>300</integer>
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
  await unload(legacyLabel);
  await unload(label);
  await execFileAsync("/bin/launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
  await execFileAsync("/bin/launchctl", ["print", `gui/${uid}/${label}`]);

  process.stdout.write(`Installed ${label}.\n`);
  process.stdout.write("The watcher starts at login and remains active in the background.\n");
  process.stdout.write(`Legacy one-shot service unloaded: ${legacyLabel}.\n`);
  process.stdout.write(`Plist: ${plistPath}\n`);
  process.stdout.write(`Logs: ${stdoutPath}, ${stderrPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
