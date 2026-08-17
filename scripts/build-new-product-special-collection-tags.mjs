#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { CATALOG_COLLECTION_PLAN } from "../src/lib/catalog-collection-plan.js";

const rootDir = resolve(import.meta.dirname, "..");

const ANIME_FANDOM_SIGNALS = [
  /\banime\b/i,
  /\bmanga\b/i,
  /\bcosplay\b/i,
  /\botaku\b/i,
  /\bcartoon\b/i,
  /\bkawaii\b/i,
  /\bcharacter\b/i,
  /\bcomic/i,
  /\bchibi\b/i,
  /\bwaifu\b/i,
  /\bmanhua\b/i,
  /\bmanhwa\b/i,
  /\bnaruto\b/i,
  /code[\s-]+geass/i,
  /\bpokemon\b/i,
  /\bpikachu\b/i,
  /dragon[\s-]+ball/i,
  /demon[\s-]+slayer/i,
  /jujutsu[\s-]+kaisen/i,
  /attack[\s-]+on[\s-]+titan/i,
  /my[\s-]+hero[\s-]+academia/i,
  /sailor[\s-]+moon/i,
  /\bsanrio\b/i,
  /hello[\s-]+kitty/i,
  /\bkuromi\b/i,
  /\btotoro\b/i,
  /\bgundam\b/i,
  /\bbleach\b/i,
  /death[\s-]+note/i,
  /studio[\s-]+ghibli/i,
  /\bdisney\b/i,
  /\bmarvel\b/i,
  /dc[\s-]+comics/i,
  /\bmickey\b/i,
  /\bminnie\b/i,
  /spider[- ]?man/i,
  /\bbatman\b/i,
  /\bsuperman\b/i,
  /\bstitch\b/i,
  /hatsune[\s-]+miku/i,
  /league[\s-]+of[\s-]+legends/i,
  /my[\s-]+little[\s-]+pony/i,
  /\bsnoopy\b/i,
  /scooby(?:[- ]?doo)?/i,
  /\bhaikyuu\b/i,
  /demon[\s-]+hunters/i,
  /\bkpop\b/i,
  /\bidol\b/i,
  /\bphotocard/i,
  /\bbandai\b/i,
  /\bgorillaz\b/i,
  /\bcare[\s-]+bears?\b/i,
  /yu[\s-]+gi[\s-]+oh/i,
  /\bone[\s-]+piece/i,
  /\bblue[\s-]+lock/i,
];

const ANIME_MERCHANDISE_SIGNALS = [
  /\bcollect/i,
  /\bkeychain\b/i,
  /\bplush\b/i,
  /\bfigur(?:e|ine)\b/i,
  /\bposter\b/i,
  /\bwall[\s-]+art\b/i,
  /\bphotocard/i,
  /\btrading[\s-]+card/i,
  /\bcard[\s-]+holder\b/i,
  /\btoy\b/i,
];

const ANIME_BLOCKED_COLLECTION_CONTEXT = /hotel[\s-]+collection|perfume|beauty|makeup|cosmetic|banknote|currency|savings|fountain[\s-]+pen|\bpen\b|calendar|bedsheet|bed[\s-]+sheet|robe|trousers|\bshirt\b|clothing|formal|business|kitchen|cookware|hair|comb|skincare|lipstick|wallet|tactical[\s-]+bag|gym[\s-]+bag/i;
const ANIME_STRONG_MERCHANDISE_CONTEXT = /anime|manga|cosplay|otaku|cartoon|kawaii|character|comic|chibi|waifu|manhua|manhwa|sanrio|hello[\s-]+kitty|kuromi|naruto|pokemon|demon[\s-]+slayer|marvel|disney|photocard|kpop|idol|collectible|cute|doll|animal|bear|cat/i;

function matchesAnimeCollectables(signalText) {
  if (ANIME_FANDOM_SIGNALS.some((signal) => signal.test(signalText))) return true;
  if (/\bcollect/i.test(signalText) && !ANIME_BLOCKED_COLLECTION_CONTEXT.test(signalText)) return true;
  if (/\bkeychain\b/i.test(signalText) && ANIME_STRONG_MERCHANDISE_CONTEXT.test(signalText)) return true;
  if (/\bplush\b/i.test(signalText) && /doll|toy|bear|cat|animal|cartoon|kawaii|character|anime|manga|cosplay/i.test(signalText)) return true;
  if (/\bfigur(?:e|ine)\b/i.test(signalText) && !/periodic table|calendar|mendeleev/i.test(signalText)) return true;
  if (/\b(?:poster|wall[\s-]+art)\b/i.test(signalText) && /anime|manga|cosplay|cartoon|kawaii|character|comic|chibi|waifu|disney|marvel|naruto|pokemon|demon|spider|batman|superman|art/i.test(signalText)) return true;
  if (/\b(?:photocard|trading[\s-]+card)\b/i.test(signalText)) return true;
  if (/\bcard[\s-]+holder\b/i.test(signalText) && /photocard|kpop|idol|anime|cartoon|character|kawaii/i.test(signalText)) return true;
  return /\btoy\b/i.test(signalText) && ANIME_STRONG_MERCHANDISE_CONTEXT.test(signalText);
}

export const SPECIAL_COLLECTION_RULES = [
  {
    handle: "creator-essentials",
    signals: [
      /content[\s-]+creator/i,
      /\bcreator\b/i,
      /\bvlog(?:ging)?\b/i,
      /\bpodcast(?:ing)?\b/i,
      /\bteleprompter\b/i,
      /video[\s-]+capture/i,
      /capture[\s-]+card/i,
      /\bwebcam\b/i,
      /ring[\s-]+light/i,
      /selfie[\s-]+light/i,
      /\bsoftbox\b/i,
      /green[\s-]+screen/i,
      /stream[\s-]+deck/i,
      /live[\s-]+stream(?:ing)?/i,
      /\blivestream\b/i,
      /studio[\s-]+light(?:ing)?/i,
      /camera[\s-]+tripod/i,
      /camera[\s-]+gimbal/i,
      /camera[\s-]+(?:microphone|mic)/i,
      /wireless[\s-]+mic/i,
      /video[\s-]+recorder/i,
      /video[\s-]+grabber/i,
      /camera[\s-]+rig/i,
      /photo[\s-]+studio/i,
      /photography[\s-]+studio/i,
      /phone[\s-]+tripod/i,
      /\b(?:microphone|microphones|mic|mics)\b/i,
      /\bcamera\b/i,
      /\b(?:video[\s-]+capture|capture[\s-]+card|video[\s-]+recorder|video[\s-]+grabber|video[\s-]+camera|video[\s-]+studio|video[\s-]+light|video[\s-]+microphone|video[\s-]+equipment|video[\s-]+production)\b/i,
      /\b(?:stream|streaming|livestream)\b/i,
      /\btripod\b/i,
      /\bselfie\b/i,
      /\brecorder\b/i,
      /\baudio\b/i,
      /\bheadphones?\b/i,
      /\bearbuds?\b/i,
      /\bspeaker\b/i,
      /\b(?:phone[\s-]+holder|phone[\s-]+stand|phone[\s-]+mount)\b/i,
    ],
  },
  {
    handle: "anime-collectables",
    signals: [...ANIME_FANDOM_SIGNALS, ...ANIME_MERCHANDISE_SIGNALS],
    matches: matchesAnimeCollectables,
  },
];

export const SPECIAL_COLLECTION_MINIMUMS = Object.freeze({
  "creator-essentials": 500,
  "anime-collectables": 1000,
});

export function assertSpecialCollectionMinimums(summary) {
  const failures = Object.entries(SPECIAL_COLLECTION_MINIMUMS)
    .filter(([handle, minimum]) => Number(summary?.[handle] || 0) < minimum)
    .map(([handle, minimum]) => `${handle}=${Number(summary?.[handle] || 0)} (minimum ${minimum})`);
  if (failures.length) throw new Error(`Special collection minimums failed: ${failures.join(", ")}`);
  return true;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function productSignalText(product) {
  return [product?.title, product?.handle, product?.product_type]
    .map(normalizeText)
    .filter(Boolean)
    .join(" ");
}

function findCollectionRule(handle) {
  const entry = CATALOG_COLLECTION_PLAN.find((candidate) => candidate.handle === handle);
  if (!entry) throw new Error(`Special collection is missing from the checked-in plan: ${handle}`);
  return entry;
}

function parseArgs(argv) {
  const args = {
    catalogPath: resolve(rootDir, "output", "new-product-cohort-catalog.json"),
    outputPath: resolve(rootDir, "output", "new-product-special-collection-tags.json"),
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--catalog-file" || token === "--output") {
      if (!next) throw new Error(`Missing value for ${token}`);
      if (token === "--catalog-file") args.catalogPath = resolve(rootDir, next);
      if (token === "--output") args.outputPath = resolve(rootDir, next);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

export function buildSpecialCollectionAssignments(products) {
  const assignments = [];
  for (const product of products) {
    const signalText = productSignalText(product);
    const matchedRules = SPECIAL_COLLECTION_RULES
      .map((rule) => ({
        ...rule,
        matchedSignals: rule.signals.filter((signal) => signal.test(signalText)).map(String),
      }))
      .filter((rule) => !rule.matches || rule.matches(signalText, rule.matchedSignals))
      .filter((rule) => rule.matchedSignals.length);

    if (!matchedRules.length) continue;

    assignments.push({
      handle: normalizeText(product.handle).toLowerCase(),
      tags: matchedRules.map((rule) => findCollectionRule(rule.handle).ruleTag),
      matchedCollections: matchedRules.map((rule) => rule.handle),
      matchedSignals: matchedRules.flatMap((rule) => rule.matchedSignals),
      rationale: "Controlled collection signals matched in the product title, handle, or product type; gated merchandise rules exclude unrelated collection products.",
    });
  }

  return assignments;
}

async function main() {
  const { catalogPath, outputPath } = parseArgs(process.argv);
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const products = Array.isArray(catalog?.products) ? catalog.products : [];
  if (!products.length) throw new Error(`Catalog contains no products: ${catalogPath}`);

  const assignments = buildSpecialCollectionAssignments(products);

  const summary = Object.fromEntries(
    SPECIAL_COLLECTION_RULES.map((rule) => [
      rule.handle,
      assignments.filter((assignment) => assignment.matchedCollections.includes(rule.handle)).length,
    ]),
  );
  assertSpecialCollectionMinimums(summary);

  await writeFile(
    outputPath,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      sourceCatalog: catalogPath,
      catalogCount: products.length,
      summary,
      assignments,
    }, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(
    `Generated ${assignments.length} special collection assignments for ${products.length} catalog products: ` +
    `${Object.entries(summary).map(([handle, count]) => `${handle}=${count}`).join(", ")}\n`,
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
