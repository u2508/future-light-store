import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolveFutureLightReleaseMode, runFutureLightReleaseCommand } from "./future-light-release-command.mjs";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("a fresh release is the default and never infers resume from arbitrary saved state", () => {
  assert.equal(resolveFutureLightReleaseMode([], {}), "fresh");
  for (const value of ["false", "0", "no", "off", ""]) {
    assert.equal(resolveFutureLightReleaseMode([], { npm_config_resume: value }), "fresh");
  }
});

test("explicit CLI and npm resume forms select the same guarded resume mode", () => {
  assert.equal(resolveFutureLightReleaseMode(["--resume"], {}), "resume");
  assert.equal(resolveFutureLightReleaseMode(["--resume"], { npm_config_resume: "true" }), "resume");
  assert.equal(resolveFutureLightReleaseMode([], { npm_config_resume: "true" }), "resume");
  assert.equal(resolveFutureLightReleaseMode([], { NPM_CONFIG_RESUME: "1" }), "resume");
});

test("unknown, duplicate, or malformed npm resume options fail closed", () => {
  assert.throws(() => resolveFutureLightReleaseMode(["--profile", "products"], {}), /Unsupported/);
  assert.throws(() => resolveFutureLightReleaseMode(["--resume", "--resume"], {}), /only once/);
  assert.throws(() => resolveFutureLightReleaseMode([], { npm_config_resume: "sometimes" }), /recognized true\/false/);
});

test("the entrypoint refuses both modes without calling an executor or contacting Shopify", () => {
  for (const modeArgs of [[], ["--resume"]]) {
    let output = "";
    const result = runFutureLightReleaseCommand({
      args: modeArgs,
      env: { FUTURE_LIGHT_SHOPIFY_ADMIN_ACCESS_TOKEN: "must-not-be-read" },
      stderr: { write: (chunk) => { output += chunk; } },
    });
    assert.equal(result.exitCode, 78);
    assert.match(output, /production Shopify handlers are not yet wired/);
    assert.match(output, /No Shopify request or mutation was made/);
    assert.match(output, /approved accurate titles and descriptions byte-for-byte/);
    assert.doesNotMatch(output, /must-not-be-read/);
  }
});

test("the real CLI entrypoint is active and blocks fresh and explicit-resume commands", () => {
  const entrypoint = new URL("./future-light-release-command.mjs", import.meta.url);
  for (const args of [[], ["--resume"]]) {
    const result = spawnSync(process.execPath, [entrypoint.pathname, ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, npm_config_resume: "false" },
    });
    assert.equal(result.status, 78, result.stderr);
    assert.match(result.stderr, /production Shopify handlers are not yet wired/);
    assert.match(result.stderr, /No Shopify request or mutation was made/);
  }
});

test("direct execution of the historical release runner is blocked before its mutation sequence", () => {
  const legacyEntrypoint = new URL("./release.mjs", import.meta.url);
  for (const args of [[], ["--products-only"], ["--profile", "daily"]]) {
    const result = spawnSync(process.execPath, [legacyEntrypoint.pathname, ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    assert.equal(result.status, 78, result.stderr);
    assert.match(result.stderr, /Legacy release runner is disabled/);
    assert.match(result.stderr, /No Shopify request or mutation was made/);
  }
});

test("the legacy release launcher is blocked before credentials, live sync, or filesystem setup", () => {
  const legacyLauncher = new URL("./run-future-light-release.mjs", import.meta.url);
  const result = spawnSync(process.execPath, [legacyLauncher.pathname], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 78, result.stderr);
  assert.match(result.stderr, /disabled before reading credentials, syncing Shopify, or creating release files/);
  assert.match(result.stderr, /No Shopify request or mutation was made/);
  assert.doesNotMatch(result.stdout, /Loading the live Shopify catalog/);
});

test("release command aliases cannot reach the historical shared release runner", () => {
  for (const name of ["release", "release:daily"]) {
    assert.equal(packageJson.scripts[name], "node scripts/future-light-release-command.mjs");
  }
  assert.equal(packageJson.scripts["release:resume"], undefined);
  assert.equal(packageJson.scripts["release:daily:resume"], undefined);
});
