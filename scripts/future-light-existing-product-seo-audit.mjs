#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { buildFutureLightExistingProductSeoAudit } from "./lib/future-light-existing-product-seo-audit.mjs";
import { FUTURE_LIGHT_SHOP_DOMAIN } from "./lib/product-image-health.mjs";

const rootDir = resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const args = { snapshot: "", output: "", maxAgeMinutes: 30, help: false };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--snapshot") args.snapshot = argv[++index] || "";
    else if (token === "--output") args.output = argv[++index] || "";
    else if (token === "--max-age-minutes") args.maxAgeMinutes = Number(argv[++index] || "30");
    else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error(`Unknown argument ${token}. Use --help for usage.`);
  }
  return args;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(
      "Usage: npm run shopify:product-seo:audit -- --snapshot <complete-current-snapshot.json> [--output <report.json>] [--max-age-minutes 30]\n" +
        "Read-only. Audits existing ACTIVE products only; never calls Shopify or writes catalog data.\n",
    );
    return;
  }
  if (!args.snapshot) throw new Error("Pass --snapshot with a complete, fresh all-status Future Light Shopify snapshot.");
  if (!Number.isFinite(args.maxAgeMinutes) || args.maxAgeMinutes <= 0) {
    throw new Error("--max-age-minutes must be a positive number.");
  }

  const snapshotPath = isAbsolute(args.snapshot) ? args.snapshot : resolve(rootDir, args.snapshot);
  const outputPath = args.output
    ? (isAbsolute(args.output) ? args.output : resolve(rootDir, args.output))
    : resolve(rootDir, "output", `future-light-existing-product-seo-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const [raw, snapshotSha256] = await Promise.all([
    readFile(snapshotPath, "utf8"),
    sha256File(snapshotPath),
  ]);
  const snapshot = JSON.parse(raw);
  const report = buildFutureLightExistingProductSeoAudit(snapshot, {
    expectedShopDomain: FUTURE_LIGHT_SHOP_DOMAIN,
    now: Date.now(),
    maxAgeMs: args.maxAgeMinutes * 60_000,
    snapshotSha256,
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ outputPath, snapshotSha256, ...report.summary }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Existing-product SEO audit failed closed: ${error?.message || error}\n`);
  process.exitCode = 1;
});
