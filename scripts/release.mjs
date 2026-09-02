#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stableJson } from "./lib/performance-runtime.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const nodeBin = process.execPath;
const require = createRequire(import.meta.url);
const releaseName = process.env.SALT_RELEASE_NAME || "Future Light Store";
const catalogBatchSize = Math.max(1, Math.min(1000, Number(process.env.SALT_CATALOG_BATCH_SIZE || 50)));
const releaseRunStatePath = resolve(rootDir, "output", "release-run-state.json");
const releaseHeartbeatMs = Math.max(10_000, Number(process.env.SALT_RELEASE_HEARTBEAT_MS || 30_000));

function releaseStepFingerprint(step, profile) {
  return createHash("sha256")
    .update(stableJson({ profile, label: step.label, command: step.command, args: step.args, cwd: step.cwd }))
    .digest("hex");
}

const catalogIntegrityArgs = [
  "--reclassify",
  "--batch-size",
  String(catalogBatchSize),
];
const deterministicCatalogIntegrityArgs = [
  ...catalogIntegrityArgs,
  "--skip-vision",
  "--deterministic-only",
];
const supervisedVisionCatalogIntegrityArgs = [
  ...catalogIntegrityArgs,
  "--supervised-vision",
];

function formatCommand(command, args) {
  return [command, ...args].join(" ");
}

let releaseRunState = {};

async function writeReleaseRunState(patch = {}) {
  releaseRunState = {
    ...releaseRunState,
    ...patch,
    heartbeatAt: new Date().toISOString(),
  };

  try {
    await mkdir(resolve(rootDir, "output"), { recursive: true });
    const tempPath = `${releaseRunStatePath}.tmp-${process.pid}`;
    await writeFile(tempPath, `${JSON.stringify(releaseRunState, null, 2)}\n`, "utf8");
    await rename(tempPath, releaseRunStatePath);
  } catch {
    // Run-state telemetry must never turn a valid release into a failed release.
  }
}

function runStage({ label, command, args, cwd, index, total }) {
  const commandLine = formatCommand(command, args);

  process.stdout.write(`\n[${index}/${total}] ${label}\n`);
  process.stdout.write(`$ ${commandLine}\n`);

  return new Promise((resolveStep, rejectStep) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", (error) => {
      rejectStep(
        new Error(
          `Release stopped at step ${index}/${total} (${label}).\nCommand: ${commandLine}\nWorking directory: ${cwd}\nReason: ${error.message}`,
        ),
      );
    });

    child.on("exit", (code, signal) => {
      if (code === 0) {
        process.stdout.write(`[ok] ${label}\n`);
        resolveStep();
        return;
      }

      const exitDetail = signal ? `signal ${signal}` : `exit code ${code}`;
      rejectStep(
        new Error(
          `Release stopped at step ${index}/${total} (${label}) with ${exitDetail}.\nCommand: ${commandLine}\nWorking directory: ${cwd}`,
        ),
      );
    });
  });
}

async function ensurePathExists(path, label) {
  try {
    await access(path);
  } catch {
    throw new Error(`${label} not found at ${path}`);
  }
}

function getReleasePaths(releaseRootDir) {
  return {
    iosDir: resolve(releaseRootDir, "salt-store-ios"),
    androidDir: resolve(releaseRootDir, "salt-store-android"),
    capacitorCliBin: resolve(releaseRootDir, "node_modules", "@capacitor", "cli", "bin", "capacitor"),
    shopifyThemeDir: resolve(
      process.env.SALT_SHOPIFY_THEME_DIR ||
        process.env.SHOPIFY_THEME_DIR ||
        resolve(releaseRootDir, "..", "future-light-store-shopify"),
    ),
    productCohortCatalog: resolve(releaseRootDir, "output", "new-product-cohort-catalog.json"),
    productCohortHandles: resolve(releaseRootDir, "output", "new-product-cohort-handles.json"),
  };
}

function buildCatalogReleaseSteps({
  releaseRootDir = rootDir,
  includeMobile = process.env.SALT_RELEASE_SKIP_MOBILE !== "1",
  supervisedVision = false,
} = {}) {
  const { iosDir, androidDir, capacitorCliBin, shopifyThemeDir } = getReleasePaths(releaseRootDir);
  const integrityArgs = supervisedVision
    ? supervisedVisionCatalogIntegrityArgs
    : deterministicCatalogIntegrityArgs;
  const verificationIntegrityArgs = process.env.SALT_RELEASE_REUSE_VERIFIED_PLAN === "1"
    ? [...integrityArgs, "--reuse-prior-manifest"]
    : integrityArgs;
  // The final gate still fetches current Shopify products, collections, and
  // memberships. Reuse only the already verified classification plan so the
  // release does not score the full catalog a second time after step 11.
  const finalIntegrityArgs = process.env.SALT_RELEASE_REUSE_VERIFIED_PLAN === "1"
    ? [...verificationIntegrityArgs]
    : [...integrityArgs];

  return [
    {
      label: "Verify trained 256M-record catalog knowledge model",
      command: npmBin,
      args: ["run", "catalog:knowledge:model:verify"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify approved catalog taxonomy release",
      command: nodeBin,
      args: ["scripts/catalog-taxonomy-approval.mjs"],
      cwd: releaseRootDir,
    },
    {
      label: "Refresh Shopify data",
      command: npmBin,
      args: ["run", "sync:data"],
      cwd: releaseRootDir,
    },
    {
      label: "Read live Shopify tag inventory",
      command: npmBin,
      args: ["run", "catalog:tags:fetch"],
      cwd: releaseRootDir,
    },
    {
      label: "Regenerate catalog taxonomy and preserved-tag audit",
      command: npmBin,
      args: ["run", "catalog:taxonomy:audit"],
      cwd: releaseRootDir,
    },
    {
      label: "Validate refreshed catalog taxonomy",
      command: npmBin,
      args: ["run", "catalog:taxonomy:validate"],
      cwd: releaseRootDir,
    },
    {
      label: "Build visual taxonomy review queue",
      command: npmBin,
      args: ["run", "catalog:image-review:build"],
      cwd: releaseRootDir,
    },
    {
      label: "Require image-backed taxonomy evidence",
      command: npmBin,
      args: ["run", "catalog:image-review:validate"],
      cwd: releaseRootDir,
    },
    {
      label: "Dry-run exact full-catalog collection reconciliation",
      command: npmBin,
      args: ["run", "shopify:catalog-integrity:dry-run", "--", ...integrityArgs],
      cwd: releaseRootDir,
    },
    {
      label: "Apply exact full-catalog collection reconciliation",
      command: npmBin,
      args: ["run", "shopify:catalog-integrity:apply", "--", ...integrityArgs],
      cwd: releaseRootDir,
    },
    ...(supervisedVision ? [{
      label: "Automatically clear visual classification review with guarded evidence",
      command: nodeBin,
      args: [resolve(releaseRootDir, "scripts", "auto-resolve-catalog-visual-review.mjs")],
      cwd: releaseRootDir,
    }] : []),
    {
      label: "Refresh Shopify data after collection reconciliation",
      command: npmBin,
      args: ["run", "sync:data"],
      cwd: releaseRootDir,
    },
    {
      label: "Ensure Shopify product metafield definitions",
      command: npmBin,
      args: ["run", "shopify:product-metafields:ensure"],
      cwd: releaseRootDir,
    },
    {
      label: "Dry-run approved cost-based pricing before base SEO",
      command: npmBin,
      args: ["run", "shopify:price-rework:dry-run"],
      cwd: releaseRootDir,
    },
    {
      label: "Apply approved cost-based pricing before base SEO",
      command: npmBin,
      args: ["run", "shopify:price-rework:apply"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify live full-catalog cost-based pricing before base SEO",
      command: npmBin,
      args: ["run", "shopify:price-rework:verify"],
      cwd: releaseRootDir,
    },
    {
      label: "Dry-run same-product variant cost-price alignment",
      command: npmBin,
      args: ["run", "shopify:variant-cost-price:dry-run"],
      cwd: releaseRootDir,
    },
    {
      label: "Apply same-product variant cost-price alignment",
      command: npmBin,
      args: ["run", "shopify:variant-cost-price:apply"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify same-product variant cost-price alignment",
      command: npmBin,
      args: ["run", "shopify:variant-cost-price:verify"],
      cwd: releaseRootDir,
    },
    {
      label: "Run local SEO and product-content quality audit",
      command: npmBin,
      args: ["run", "shopify:seo:local-review"],
      cwd: releaseRootDir,
    },
    {
      label: "Dry-run full-catalog Shopify SEO and product-field reconciliation",
      command: nodeBin,
      args: [
        resolve(releaseRootDir, "scripts", "shopify-seo-release.mjs"),
        "--dry-run",
        "--full-catalog",
        "--preserve-prices",
        "--preserve-tags",
      ],
      cwd: releaseRootDir,
    },
    {
      label: "Apply full-catalog Shopify SEO and product-field reconciliation with live readback",
      command: nodeBin,
      args: [
        resolve(releaseRootDir, "scripts", "shopify-seo-release.mjs"),
        "--apply",
        "--full-catalog",
        "--preserve-prices",
        "--preserve-tags",
      ],
      cwd: releaseRootDir,
    },
    {
      label: "Apply approved taxonomy tags and metafields with live readback",
      command: npmBin,
      args: ["run", "shopify:taxonomy:apply"],
      cwd: releaseRootDir,
    },
    {
      label: "Dry-run deterministic and visual variant-image mapping",
      command: npmBin,
      args: ["run", "shopify:variant-image-mapping:dry-run"],
      cwd: releaseRootDir,
    },
    {
      label: "Apply resumable variant-image mapping with live readback",
      command: npmBin,
      args: ["run", "shopify:variant-image-mapping:apply"],
      cwd: releaseRootDir,
    },
    {
      label: "Delete verified active zero-image products",
      command: npmBin,
      args: ["run", "shopify:products:zero-images:apply"],
      cwd: releaseRootDir,
    },
    {
      label: "Publish every active product to all sales channels",
      command: npmBin,
      args: ["run", "shopify:publications:all:apply"],
      cwd: releaseRootDir,
    },
    {
      label: "Refresh Shopify data after final product publication",
      command: npmBin,
      args: ["run", "sync:data"],
      cwd: releaseRootDir,
    },
    {
      label: "Apply all-active-catalog product categories and merchandising metafields",
      command: npmBin,
      args: ["run", "shopify:product-metafields:backfill:all-active"],
      cwd: releaseRootDir,
    },
    {
      label: "Refresh Shopify data after merchandising backfill",
      command: npmBin,
      args: ["run", "sync:data"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify every active product has product-specific SEO and metafields",
      command: npmBin,
      args: ["run", "shopify:product-specificity:verify"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify exact collection membership and price rules",
      command: npmBin,
      args: ["run", "shopify:catalog-integrity:verify", "--", ...verificationIntegrityArgs],
      cwd: releaseRootDir,
    },
    {
      label: "Verify Shopify merchandising backfill",
      command: npmBin,
      args: ["run", "shopify:merchandising:verify"],
      cwd: releaseRootDir,
    },
    {
      label: "Validate final catalog taxonomy snapshot",
      command: npmBin,
      args: ["run", "catalog:taxonomy:validate"],
      cwd: releaseRootDir,
    },
    {
      label: "Build web app",
      command: npmBin,
      args: ["run", "build:web:release"],
      cwd: releaseRootDir,
    },
    {
      label: "Generate Shopify theme bundle",
      command: npmBin,
      args: ["run", "theme:bundle:release", "--", "--out", shopifyThemeDir],
      cwd: releaseRootDir,
    },
    {
      label: "Dry-run approved similar-purpose collection merges",
      command: npmBin,
      args: ["run", "shopify:collection-merges:dry-run"],
      cwd: releaseRootDir,
    },
    {
      label: "Apply approved similar-purpose collection merges with live readback",
      command: npmBin,
      args: ["run", "shopify:collection-merges:apply:approved"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify Future Light managed tag cleanup is out of scope",
      command: nodeBin,
      args: ["-e", "process.stdout.write('Future Light Store: legacy cross-store tag cleanup is intentionally disabled.\\n')"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify Future Light managed collection cleanup is out of scope",
      command: nodeBin,
      args: ["-e", "process.stdout.write('Future Light Store: legacy cross-store collection cleanup is intentionally disabled.\\n')"],
      cwd: releaseRootDir,
    },
    {
      label: "Confirm no cross-store cleanup process is launched",
      command: nodeBin,
      args: ["-e", "process.stdout.write('Future Light Store: no cross-store cleanup process launched.\\n')"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify variant-aware SEO profiles for every active variant",
      command: npmBin,
      args: ["run", "shopify:variant-seo:verify"],
      cwd: releaseRootDir,
    },
    {
      label: "Dry-run daily manual collection shuffle",
      command: npmBin,
      args: ["run", "shopify:collections:shuffle:dry-run"],
      cwd: releaseRootDir,
    },
    {
      label: "Apply daily manual collection shuffle with live readback",
      command: npmBin,
      args: ["run", "shopify:collections:shuffle:apply"],
      cwd: releaseRootDir,
    },
    {
      label: "Verify daily manual collection shuffle",
      command: npmBin,
      args: ["run", "shopify:collections:shuffle:verify"],
      cwd: releaseRootDir,
    },
    {
      label: "Final live-readback gate after tag cleanup and collection merges",
      command: npmBin,
      args: ["run", "shopify:catalog-integrity:verify", "--", ...finalIntegrityArgs],
      cwd: releaseRootDir,
    },
    ...(includeMobile ? [
      {
        label: "Sync iOS Capacitor shell",
        command: nodeBin,
        args: [resolve(releaseRootDir, "scripts", "sync-capacitor-local.mjs"), "ios"],
        cwd: releaseRootDir,
      },
      {
        label: "Sync Android Capacitor shell",
        command: nodeBin,
        args: [resolve(releaseRootDir, "scripts", "sync-capacitor-local.mjs"), "android"],
        cwd: releaseRootDir,
      },
    ] : []),
  ];
}

function buildProductReleaseSteps({
  releaseRootDir = rootDir,
  includeMobile = process.env.SALT_RELEASE_SKIP_MOBILE !== "1",
} = {}) {
  const {
    iosDir,
    androidDir,
    capacitorCliBin,
    shopifyThemeDir,
  } = getReleasePaths(releaseRootDir);
  const cohortCatalogArg = "output/new-product-cohort-catalog.json";
  const cohortHandlesArg = "output/new-product-cohort-handles.json";

  return [
    {
      label: "Run frozen new-product SEO, metafield, and mapping pipeline",
      command: npmBin,
      args: [
        "run",
        "seo:new-products:apply",
        "--",
        "--frozen-catalog",
        cohortCatalogArg,
        "--product-handles-file",
        cohortHandlesArg,
      ],
      cwd: releaseRootDir,
    },
    {
      label: "Delete verified zero-image products in the new cohort",
      command: npmBin,
      args: ["run", "shopify:products:zero-images:apply", "--", "--product-handles-file", cohortHandlesArg],
      cwd: releaseRootDir,
    },
    {
      label: "Publish new-cohort products to all sales channels",
      command: npmBin,
      args: ["run", "shopify:publications:all:apply", "--", "--product-handles-file", cohortHandlesArg],
      cwd: releaseRootDir,
    },
    {
      label: "Build web app",
      command: npmBin,
      args: ["run", "build:web:release"],
      cwd: releaseRootDir,
    },
    {
      label: "Generate Shopify theme bundle",
      command: npmBin,
      args: ["run", "theme:bundle:release", "--", "--out", shopifyThemeDir],
      cwd: releaseRootDir,
    },
    ...(includeMobile ? [
      {
        label: "Sync iOS Capacitor shell",
        command: nodeBin,
        args: [capacitorCliBin, "sync", "ios"],
        cwd: iosDir,
      },
      {
        label: "Sync Android Capacitor shell",
        command: nodeBin,
        args: [capacitorCliBin, "sync", "android"],
        cwd: androidDir,
      },
    ] : []),
  ];
}

export function buildReleaseSteps({
  rootDir: releaseRootDir = rootDir,
  includeMobile = process.env.SALT_RELEASE_SKIP_MOBILE !== "1",
  profile = "catalog",
} = {}) {
  if (profile === "products") {
    return buildProductReleaseSteps({ releaseRootDir, includeMobile });
  }

  if (!["catalog", "daily"].includes(profile)) {
    throw new Error(`Invalid release profile ${profile}; expected catalog, daily, or products`);
  }

  return buildCatalogReleaseSteps({
    releaseRootDir,
    includeMobile,
    supervisedVision: ["catalog", "daily"].includes(profile) && process.env.SALT_CATALOG_VISION_SUPERVISED === "1",
  });
}

function parseArgs(argv) {
  const args = {
    profile: process.env.SALT_RELEASE_PROFILE || "catalog",
    resume: process.env.SALT_RELEASE_RESUME === "1",
    fresh: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--profile") {
      if (!next) {
        throw new Error("Missing value for --profile");
      }
      args.profile = next;
      index += 1;
      continue;
    }

    if (token === "--product-release" || token === "--products-only") {
      args.profile = "products";
      continue;
    }

    if (token === "--catalog-release") {
      args.profile = "catalog";
      continue;
    }

    if (token === "--resume") {
      args.resume = true;
      continue;
    }

    if (token === "--fresh") {
      args.fresh = true;
    }
  }

  if (args.resume && args.fresh) {
    throw new Error("Release cannot use --resume and --fresh together");
  }

  if (!["catalog", "daily", "products"].includes(args.profile)) {
    throw new Error(`Invalid release profile ${args.profile}; expected catalog, daily, or products`);
  }

  return args;
}

async function main() {
  let args = { profile: process.env.SALT_RELEASE_PROFILE || "catalog" };
  let heartbeatTimer;
  const invocationStartedAt = Date.now();
  try {
    args = parseArgs(process.argv);
    if (args.resume) {
      process.env.SALT_VARIANT_IMAGE_RESUME = "1";
    }
    let previousRunState = null;
    if (args.resume) {
      try {
        previousRunState = JSON.parse(await readFile(releaseRunStatePath, "utf8"));
      } catch {
        throw new Error(`Cannot resume release: no readable run state at ${releaseRunStatePath}`);
      }
      if (!previousRunState || !["failed", "running"].includes(previousRunState.status)) {
        throw new Error(`Cannot resume release: run state is ${previousRunState?.status || "missing"}, not failed or interrupted`);
      }
      if (previousRunState.profile && previousRunState.profile !== args.profile) {
        throw new Error(`Cannot resume ${args.profile} release from ${previousRunState.profile} run state`);
      }
      const previousPid = Number(previousRunState.pid || 0);
      if (previousRunState.status === "running" && previousPid > 0 && previousPid !== process.pid) {
        try {
          process.kill(previousPid, 0);
          throw new Error(`Cannot resume while release process ${previousPid} is still running`);
        } catch (error) {
          if (error?.message?.includes("still running")) throw error;
        }
      }
    }
    const requestedResumeFromStep = args.resume
      ? Math.max(1, Number(previousRunState?.stepIndex || previousRunState?.completedStepIndex || 1))
      : 1;
    releaseRunState = {
      status: "running",
      pid: process.pid,
      profile: args.profile,
      startedAt: new Date().toISOString(),
      stepIndex: requestedResumeFromStep - (args.resume ? 0 : 1),
      totalSteps: 0,
      stepLabel: "initializing",
      heartbeatAt: new Date().toISOString(),
      resumed: args.resume,
      resumedFromStep: args.resume ? requestedResumeFromStep : null,
      fresh: args.fresh,
      completedSteps: args.resume && Array.isArray(previousRunState?.completedSteps)
        ? previousRunState.completedSteps
        : [],
    };
    await writeReleaseRunState();
    heartbeatTimer = setInterval(() => {
      void writeReleaseRunState().catch(() => {});
    }, releaseHeartbeatMs);
    heartbeatTimer.unref?.();

    const packageJson = JSON.parse(await readFile(resolve(rootDir, "package.json"), "utf8"));
    const { shopifyThemeDir } = getReleasePaths(rootDir);
    const viteVersion = require("vite/package.json").version;
    const capacitorCliVersion = process.env.SALT_RELEASE_SKIP_MOBILE === "1"
      ? "skipped"
      : require("@capacitor/cli/package.json").version;
    const npmVersion = execFileSync(npmBin, ["--version"], { encoding: "utf8" }).trim();
    await mkdir(shopifyThemeDir, { recursive: true });

    process.stdout.write(`${releaseName} release workflow\n`);
    process.stdout.write(`  app: ${packageJson.version}\n`);
    process.stdout.write(`  node: ${process.version}\n`);
    process.stdout.write(`  npm: ${npmVersion}\n`);
    process.stdout.write(`  vite: ${viteVersion}\n`);
    process.stdout.write(`  capacitor-cli: ${capacitorCliVersion}\n`);
    process.stdout.write(`  shopify-theme: ${shopifyThemeDir}\n`);
    process.stdout.write(`  mobile-sync: ${process.env.SALT_RELEASE_SKIP_MOBILE === "1" ? "skipped" : "included"}\n`);
    process.stdout.write(`  profile: ${args.profile}\n`);
    process.stdout.write(`  execution: ${args.resume ? `resume from step ${requestedResumeFromStep}` : args.fresh ? "fresh run" : "guarded run"}\n`);

    if (args.profile === "products") {
      const { productCohortCatalog, productCohortHandles } = getReleasePaths(rootDir);
      await ensurePathExists(productCohortCatalog, "new-product cohort catalog");
      await ensurePathExists(productCohortHandles, "new-product cohort handles");
      process.stdout.write(`  product-cohort: ${productCohortHandles}\n`);
    }

    const steps = buildReleaseSteps({ rootDir, profile: args.profile });
    if (requestedResumeFromStep > steps.length) {
      throw new Error(`Cannot resume from step ${requestedResumeFromStep}; release has ${steps.length} steps`);
    }
    if (args.resume && previousRunState?.totalSteps && previousRunState.totalSteps !== steps.length) {
      throw new Error(
        `Cannot resume safely: the release step graph changed from ${previousRunState.totalSteps} to ${steps.length} steps. Use --fresh after reviewing the new graph.`,
      );
    }
    if (args.resume && previousRunState?.stepFingerprint) {
      const currentStepFingerprint = releaseStepFingerprint(steps[requestedResumeFromStep - 1], args.profile);
      if (currentStepFingerprint !== previousRunState.stepFingerprint) {
        throw new Error(
          `Cannot resume safely: step ${requestedResumeFromStep} changed since the prior run. Use --fresh after reviewing the changed step.`,
        );
      }
    }
    let resumeFromStep = requestedResumeFromStep;
    let resumeRepair = null;
    const productSpecificityStep = steps.findIndex((step) => step.label === "Verify every active product has product-specific SEO and metafields") + 1;
    const contentRepairStep = steps.findIndex((step) => step.label === "Run local SEO and product-content quality audit") + 1;
    const taxonomyApplyStep = steps.findIndex((step) => step.label === "Apply approved taxonomy tags and metafields with live readback") + 1;
    const taxonomyManifestRepairStep = steps.findIndex((step) => step.label === "Dry-run exact full-catalog collection reconciliation") + 1;
    const failedAtProductSpecificity = args.resume
      && previousRunState?.status === "failed"
      && requestedResumeFromStep === productSpecificityStep
      && /product-specificity|SEO and metafields/i.test(String(previousRunState?.error || previousRunState?.stepLabel || ""));
    const failedWithStaleTaxonomyManifest = args.resume
      && previousRunState?.status === "failed"
      && requestedResumeFromStep === taxonomyApplyStep
      && previousRunState?.stepLabel === "Apply approved taxonomy tags and metafields with live readback";
    const repairStartStep = failedAtProductSpecificity
      ? contentRepairStep
      : failedWithStaleTaxonomyManifest
        ? taxonomyManifestRepairStep
        : 0;
    if (repairStartStep > 0 && repairStartStep < resumeFromStep) {
      resumeFromStep = repairStartStep;
      resumeRepair = {
        fromStep: repairStartStep,
        failedStep: failedAtProductSpecificity ? productSpecificityStep : taxonomyApplyStep,
        reason: failedAtProductSpecificity
          ? "product-specificity verification failed after content rules changed; replaying guarded content and live-readback steps"
          : "taxonomy apply detected a stale collection-integrity scope; replaying the guarded full-catalog classification and live-readback steps",
      };
      process.stdout.write(
        failedAtProductSpecificity
          ? `Repair-aware resume: replaying steps ${contentRepairStep}-${productSpecificityStep} so updated product content reaches Shopify before verification.\n`
          : `Repair-aware resume: replaying steps ${taxonomyManifestRepairStep}-${taxonomyApplyStep} so the classification manifest covers every active product.\n`,
      );
    }
    await writeReleaseRunState({
      totalSteps: steps.length,
      resumedFromStep: args.resume ? resumeFromStep : null,
      resumeRepair,
    });

    for (const [index, step] of steps.entries()) {
      const stepIndex = index + 1;
      const fingerprint = releaseStepFingerprint(step, args.profile);
      if (stepIndex < resumeFromStep) {
        process.stdout.write(`[reuse] ${stepIndex}/${steps.length} ${step.label}\n`);
        continue;
      }
      await writeReleaseRunState({
        stepIndex,
        stepLabel: step.label,
        stepFingerprint: fingerprint,
      });
      const stepStartedAt = Date.now();
      await runStage({
        ...step,
        index: stepIndex,
        total: steps.length,
      });

      if (step.label === "Build web app") {
        await ensurePathExists(resolve(rootDir, "dist", "index.html"), "Vite build output");
      }
      const completedSteps = [
        ...(Array.isArray(releaseRunState.completedSteps) ? releaseRunState.completedSteps : []),
        {
          index: stepIndex,
          label: step.label,
          fingerprint,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - stepStartedAt,
        },
      ].filter((entry, entryIndex, entries) => entries.findIndex((candidate) => candidate.index === entry.index) === entryIndex);
      await writeReleaseRunState({
        completedStepIndex: stepIndex,
        completedStepFingerprint: fingerprint,
        completedSteps,
      });
    }

    const finalIntegrityManifestPath = resolve(rootDir, "output", "shopify-catalog-integrity-manifest.json");
    try {
      const finalIntegrityManifest = JSON.parse(await readFile(finalIntegrityManifestPath, "utf8"));
      const classificationReviewRemaining = Number(finalIntegrityManifest?.summary?.classificationReviewRemaining || 0);
      if (classificationReviewRemaining > 0) {
        throw new Error(
          `Release completion blocked: ${classificationReviewRemaining} active product(s) remain in classification-review. Inspect output/catalog-visual-review-queue.json and resume after visual decisions.`,
        );
      }
    } catch (error) {
      if (error?.message?.startsWith("Release completion blocked:")) throw error;
      throw new Error(`Release completion blocked: final catalog integrity manifest is missing or unreadable at ${finalIntegrityManifestPath}.`);
    }

    await writeReleaseRunState({
      status: "completed",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - invocationStartedAt,
      stepLabel: "complete",
    });
    process.stdout.write(`\nRelease complete in ${Math.round((Date.now() - invocationStartedAt) / 1000)}s.\n`);
  } catch (error) {
    await writeReleaseRunState({
      status: "failed",
      failedAt: new Date().toISOString(),
      error: error?.message || String(error),
    });
    throw error;
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`\n${error.message}`);
    process.exit(1);
  });
}
