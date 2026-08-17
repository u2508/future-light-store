#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const nodeBin = process.execPath;

function run(label, command, args) {
  process.stdout.write(`\n${label}\n`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed; Shopify SEO apply was not started.`);
  }
}

const resumeAtVariantImage = process.env.SALT_SEO_GUARDED_RESUME_FROM_VARIANT_IMAGE === "1";

if (!resumeAtVariantImage) {
  run("1. Verify trained 128M-record catalog knowledge model", npmBin, ["run", "catalog:knowledge:model:verify"]);
  run("2. Verify catalog taxonomy approval", nodeBin, ["scripts/catalog-taxonomy-approval.mjs"]);
  run("3. Validate local catalog taxonomy", npmBin, ["run", "catalog:taxonomy:validate"]);
  run("4. Build the visual taxonomy review queue", npmBin, ["run", "catalog:image-review:build"]);
  run("5. Require image-backed evidence for every review-required product", npmBin, ["run", "catalog:image-review:validate"]);
  run("6. Full local catalog SEO audit", npmBin, ["run", "shopify:seo:local-review"]);
  run("7. Live taxonomy tags and metafields dry-run", npmBin, ["run", "shopify:taxonomy:dry-run"]);
  run("8. Live full-catalog Shopify SEO dry-run with prices and tags preserved", nodeBin, ["scripts/shopify-seo-release.mjs", "--dry-run", "--full-catalog", "--preserve-prices", "--preserve-tags"]);
  run("9. Guarded full-catalog Shopify SEO apply with prices and tags preserved", nodeBin, ["scripts/shopify-seo-release.mjs", "--apply", "--full-catalog", "--preserve-prices", "--preserve-tags"]);
  run("10. Apply taxonomy tags and metafields with live readback", npmBin, ["run", "shopify:taxonomy:apply"]);
} else {
  process.stdout.write("Reusing completed guarded SEO and taxonomy stages; resuming at variant image mapping.\n");
}

run(
  "11. Auto-run variant image mapping",
  nodeBin,
  [
    "scripts/shopify-variant-image-mapping.mjs",
    "--apply",
    "--scope",
    "all-products",
    ...(process.env.SALT_VARIANT_IMAGE_NO_VISION === "1" ? ["--no-vision"] : []),
    ...(process.env.SALT_VARIANT_IMAGE_RESUME === "1" ? ["--resume"] : []),
  ],
);

process.stdout.write("\nGuarded Shopify SEO apply completed.\n");
