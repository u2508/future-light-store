#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { socialPaths } from "./lib/vs-store-social-state.mjs";

const rootDir = resolve(import.meta.dirname, "..");

function parseArgs(argv) {
  const args = { show: false, writeResult: false };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--show") args.show = true;
    else if (token === "--write-result") args.writeResult = true;
    else if (token === "--run-key") args.runKey = argv[++index];
    else if (token === "--fingerprint") args.fingerprint = argv[++index];
    else if (token === "--post-id") args.postId = argv[++index];
    else if (token === "--post-url") args.postUrl = argv[++index];
    else if (token === "--post-caption") args.postCaption = argv[++index];
    else if (token === "--post-scheduled-at") args.postScheduledAt = argv[++index];
    else if (token === "--instagram-post-id") args.instagramPostId = argv[++index];
    else if (token === "--instagram-post-url") args.instagramPostUrl = argv[++index];
    else if (token === "--instagram-post-caption") args.instagramPostCaption = argv[++index];
    else if (token === "--instagram-post-scheduled-at")
      args.instagramPostScheduledAt = argv[++index];
    else if (token === "--discount-id") args.discountId = argv[++index];
    else if (token === "--discount-code") args.discountCode = argv[++index];
    else if (token === "--discount-percent") args.discountPercent = Number(argv[++index]);
    else if (token === "--discount-starts-at") args.discountStartsAt = argv[++index];
    else if (token === "--discount-ends-at") args.discountEndsAt = argv[++index];
    else if (token === "--discount-target-type") args.discountTargetType = argv[++index];
    else if (token === "--discount-all-items") args.discountAllItems = true;
    else if (token === "--discount-applies-once") args.discountAppliesOncePerCustomer = true;
    else if (token === "--discount-no-stacking") args.discountNoStacking = true;
    else if (token === "--skip-offer") args.skipOffer = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

async function showRequest() {
  const requestPath = socialPaths(rootDir).browserRequest;
  const request = JSON.parse(await readFile(requestPath, "utf8"));
  process.stdout.write(`${JSON.stringify(request, null, 2)}\n`);
}

async function writeResult(args) {
  if (
    !args.runKey ||
    !args.fingerprint ||
    !args.postId ||
    !args.postUrl ||
    !args.instagramPostId ||
    !args.instagramPostUrl
  ) {
    throw new Error(
      "--write-result requires Facebook and Instagram post IDs and URLs, plus --run-key and --fingerprint.",
    );
  }
  if (
    !args.skipOffer &&
    (!args.discountId || !args.discountCode || ![10, 15].includes(args.discountPercent))
  ) {
    throw new Error(
      "A non-skipped offer requires verified --discount-id, --discount-code, and --discount-percent 10 or 15.",
    );
  }
  const result = {
    schemaVersion: 1,
    status: "success",
    runKey: args.runKey,
    fingerprint: args.fingerprint,
    post: {
      verified: true,
      id: args.postId,
      url: args.postUrl,
      caption: args.postCaption || null,
      scheduledAt: args.postScheduledAt || null,
    },
    instagramPost: {
      verified: true,
      id: args.instagramPostId,
      url: args.instagramPostUrl,
      caption: args.instagramPostCaption || args.postCaption || null,
      scheduledAt: args.instagramPostScheduledAt || args.postScheduledAt || null,
    },
    discount: args.skipOffer
      ? null
      : {
          verified: true,
          id: args.discountId,
          code: args.discountCode,
          percent: args.discountPercent,
          startsAt: args.discountStartsAt || null,
          endsAt: args.discountEndsAt || null,
          targetType: args.discountTargetType || null,
          allItems: Boolean(args.discountAllItems),
          appliesOncePerCustomer: Boolean(args.discountAppliesOncePerCustomer),
          combinesWith: args.discountNoStacking
            ? { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false }
            : null,
        },
    offerSkipped: Boolean(args.skipOffer),
  };
  const resultPath = socialPaths(rootDir).browserResult;
  // Place the browser result in its dedicated filename with atomic semantics.
  const { mkdir, rename, writeFile } = await import("node:fs/promises");
  await mkdir(socialPaths(rootDir).directory, { recursive: true });
  const temporaryPath = `${resultPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await rename(temporaryPath, resultPath);
  process.stdout.write(
    `Browser fallback result saved at ${resultPath}. Run npm run social:daily -- --resume-browser.\n`,
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.show) return showRequest();
  if (args.writeResult) return writeResult(args);
  throw new Error("Use --show or --write-result.");
}

main().catch((error) => {
  process.stderr.write(`VS Store social browser bridge failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
