#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildSeoBatchPlan } from "../src/lib/shopify-seo-batch-intelligence.js";
import { classifyCatalogTaxonomy } from "../src/lib/catalog-taxonomy.js";
import { readCatalogKnowledgeModel } from "./catalog-knowledge-model-files.mjs";

const liveCatalogSnapshotPath = resolve(import.meta.dirname, "../output/.shopify-seo-live-catalog.json");

const fixtures = [
  {
    name: "camera mounting arm with stale women tag",
    product: {
      id: "15992230051921",
      handle:
        "3-section-double-articulated-arm-5-8-hex-pin-with-1-4-20-female-thread-5-8-pin-with-3-8-16-female-thread",
      title:
        "3-Section Double Articulated Arm 5/8 Hex Pin with 1/4-20 Female Thread 5/8 Pin with 3/8-16 Female Thread",
      tags: ["camera-accessory", "women"],
      body: "Camera mounting arm with 5/8 hex pin and 1/4-20 female thread.",
      expectedRule: "camera-accessory",
      expectedTitle: /camera mounting arm/i,
      expectedBody: [/articulated arm/i, /1\/4-20 female thread/i, /3\/8-16 female thread/i],
    },
  },
  {
    name: "AUX cable with connector gender wording and stale men tag",
    product: {
      id: "15992228872273",
      handle:
        "funny-jack-3-5mm-aux-audio-cable-to-xh2-54-3p-terminal-male-to-male-female-3-core-stereo-audio-cable-amplifier-extended-line",
      title:
        "FunnyJack 3.5mm AUX Audio Cable To XH2.54 3p Terminal Male To Male Female 3 Core Stereo Audio Cable Amplifier Extended Line",
      tags: ["electronic-adapter", "men"],
      body: "Brand Name: KOQZM\nChoice: yes\nOrigin: CN\nType: Audio Extension Cord.",
      expectedRule: "electronic-adapter",
      expectedTitle: /3\.5mm AUX Audio Cable.*XH2\.54/i,
      expectedBody: [/3\.5mm AUX/i, /XH2\.54 3-pin terminal/i, /male-to-male/i],
    },
  },
  {
    name: "explicit women fashion item remains women",
    product: {
      id: "listing-fixture-women-belt",
      handle: "womens-leather-waist-belt",
      title: "Women's Leather Waist Belt",
      tags: [],
      body: "Leather waist belt for women's everyday outfits.",
      expectedRule: "belt",
      expectedAudience: "women",
      expectedTitle: /belt/i,
      expectedBody: [/belt/i],
    },
  },
  {
    name: "car phone holder keeps its mounting purpose",
    product: {
      id: "listing-fixture-car-holder",
      handle: "360-rotatable-car-phone-holder-universal-cell-phone-stands-car-rack",
      title: "360 Rotatable Car Phone Holder Universal Cell Phone Stands Car Rack",
      tags: [],
      body: "",
      expectedRule: "phone-tablet-stand",
      expectedTitle: /360.*car phone holder/i,
      expectedBody: [/phone holder/i, /car use/i],
      requireModel: false,
    },
  },
  {
    name: "stylus pen is not rewritten as a pencil case",
    product: {
      id: "listing-fixture-stylus",
      handle: "original-xiaomi-focus-stylus-pen-tab-8192-level-sense-magnetic-drawing-writing-pencil",
      title: "Original Xiaomi Focus Stylus Pen Tab 8192 Level Sense Magnetic",
      tags: [],
      body: "",
      expectedRule: "writing-supplies",
      expectedTitle: /stylus pen/i,
      expectedBody: [/writing or drawing/i],
      forbiddenBody: /pencil case/i,
      requireModel: false,
    },
  },
  {
    name: "USB-C audio cable does not inherit XH2.54 terminals",
    product: {
      id: "listing-fixture-usbc-audio",
      handle: "abzz-usb-c-to-3-5mm-cable-for-rode-wireless-go-ii-coiled-right-angle-trs-male-dac-aux-adapter-audio-cord-spare-parts",
      title: "ABZZ-USB C To 3.5Mm Cable For RODE Wireless Go II, Coiled Right Angle TRS Male DAC AUX Adapter Audio Cord Spare Parts",
      tags: [],
      body: "",
      expectedRule: "microphone-accessories",
      expectedTitle: /USB-C.*3\.5mm.*AUX/i,
      expectedBody: [/3\.5mm AUX audio/i],
      forbiddenBody: /XH2\.54/i,
      requireModel: false,
    },
  },
  {
    name: "earpads stay a headphone replacement accessory",
    product: {
      id: "listing-fixture-earpads",
      handle: "homefeeling-earpads-for-house-of-marley-positive-vibration-xl-anc-headphone-soft-earcushion-ear-pads-replacement",
      title: "Homefeeling Earpads for House of Marley Positive Vibration XL ANC Headphone",
      tags: [],
      body: "",
      expectedRule: "headphone-earpads",
      expectedTitle: /headphone replacement earpads/i,
      expectedBody: [/replacement audio accessories/i],
      requireModel: false,
    },
  },
  {
    name: "camera hot shoe is not footwear",
    product: {
      id: "listing-fixture-hot-shoe",
      handle: "camera-flash-l-bracket-dual-hot-shoes-holder-mount-adapter-mount-dv-microphone-led-light-new",
      title: "Camera Flash L Bracket Dual Hot Shoes Holder Mount Adapter",
      tags: [],
      body: "",
      expectedRule: "shoes",
      expectedTitle: /camera flash.*hot[- ]shoe/i,
      expectedBody: [/camera hot-shoe mount/i],
      forbiddenBody: /footwear style/i,
      requireModel: false,
    },
  },
  {
    name: "DC-DC power module title keeps voltage range",
    product: {
      id: "listing-fixture-dcdc",
      handle: "free-shipping-10pcs-3-3v-5v-9v-12v-15v-24v-b0503s-b0512ss-1wr3-b1212s-1wr3-b1205s-1wr3-original-dcdc-power-module",
      title: "Free Shipping 10pcs 3.3V 5V 9V 12V 15V 24V B0503S B0512SS-1WR3 B1212S-1WR3 B1205S-1WR3 Original DCDC Power Module",
      tags: [],
      body: "",
      expectedRule: "electronic-adapter",
      expectedTitle: /10-Piece DC-DC Power Module.*3\.3V-24V/i,
      expectedBody: [/power module/i, /voltage range listed/i],
      forbiddenBody: /This product follows the|serves the specific function/i,
      requireModel: false,
    },
  },
  {
    name: "iPhone case keeps its material, protection, and device fit",
    product: {
      id: "listing-fixture-iphone-case",
      handle: "ugreen-magnetic-case-for-iphone-17-pro-cases-shockproof-cover-for-iphone-17-16-15-14-pro-air-17pro-max-for-magsafe-macsafe-case",
      title: "Ugreen Magnetic Case for iPhone 17 Pro Cases Shockproof Cover",
      tags: [],
      body: "",
      expectedRule: "phone-case",
      expectedTitle: /Ugreen Magnetic Shockproof iPhone 17 Case for Multiple Models/i,
      expectedBody: [/sized for iPhone 17/i, /exact model/i],
      requireModel: false,
    },
  },
];

function rowFor(product) {
  return {
    Handle: product.handle,
    Title: product.title,
    "Body (HTML)": product.body,
    "Product Type": "",
    Tags: product.tags.join(", "),
    "Product ID": product.id,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function auditLiveCatalog(model) {
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(liveCatalogSnapshotPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { status: "skipped", reason: "live catalog snapshot is not available yet" };
    }
    throw error;
  }

  const products = Array.isArray(snapshot?.products) ? snapshot.products : [];
  if (!products.length) return { status: "skipped", reason: "live catalog snapshot has no products" };

  const rows = products.map((product) => ({
    Handle: product.handle,
    Title: product.title,
    "Body (HTML)": product.body_html || "",
    Tags: Array.isArray(product.tags) ? product.tags.join(", ") : "",
    "Product ID": product.id,
    "Product Type": product.product_type || "",
    "Option1 Value": product.variants?.[0]?.title || "",
  }));
  const plan = await buildSeoBatchPlan(rows, {
    products,
    collections: [],
    collectionProducts: [],
    resolveCategoryId: async () => null,
    knowledgeModel: model,
  });
  const genericBody = /serves the specific function identified|supports personal audio listening|specific everyday task identified|confirmed product facts|product format and listed options support/i;
  const awkwardBody = /\bThis an\b|\bThis a\b|\bThis [^.!?]{1,80} follow\b|\bThese [^.!?]{1,80} is\b|\bThis [^.!?]{1,80} are\b|\bThis product follows the\b|\bserves the specific\b|listed detail:/i;
  const awkwardTitle = /\b(?:phone|case) iPhone\b|\biPhone (?:Pro|Max|Cases)\b|\bProduct(?: Type)?\b|\bCases? Air\b|\b(?:Phone|Case) Cases?\b/i;
  const noisyTitle = /high quality|best seller|wholesale|dropshipping|free shipping|factory direct/i;
  const failures = [];
  let titlesChanged = 0;
  let bodiesChanged = 0;
  let awkwardTitles = 0;
  let templatedBodies = 0;
  for (const product of plan.products) {
    const intelligence = product.intelligence || {};
    const body = intelligence.canonicalDescriptionHtml || "";
    if (intelligence.changedFields?.includes("title")) titlesChanged += 1;
    if (intelligence.changedFields?.includes("body")) bodiesChanged += 1;
    if (intelligence.canonicalTitle.length < 20) failures.push(`${product.handle}: title is too short`);
    if (genericBody.test(body)) failures.push(`${product.handle}: generic body fallback`);
    if (awkwardBody.test(body)) failures.push(`${product.handle}: awkward or keyword-stuffed body`);
    if (awkwardTitle.test(intelligence.canonicalTitle)) {
      awkwardTitles += 1;
      failures.push(`${product.handle}: awkward title order`);
    }
    if (/\bThis product follows the\b|\bserves the specific\b/i.test(body)) templatedBodies += 1;
    if (noisyTitle.test(intelligence.canonicalTitle)) failures.push(`${product.handle}: noisy title`);
    if (failures.length >= 20) break;
  }
  return {
    status: failures.length ? "failed" : "verified",
    products: plan.products.length,
    titlesChanged,
    bodiesChanged,
    awkwardTitles,
    templatedBodies,
    failures,
  };
}

async function main() {
  const model = await readCatalogKnowledgeModel({ required: true });
  assert(
    Number(model.trainingRecords) === 256_000_000,
    "Listing intelligence model is not trained on 256M records.",
  );
  assert(
    Number(model.representativeDocuments) >= Number(model.representativeRules) * 4,
    "Listing intelligence model lacks expanded product-language representatives.",
  );

  const failures = [];
  let catalogAudit = { status: "skipped", reason: "not run" };
  for (const fixture of fixtures) {
    try {
      const classification = classifyCatalogTaxonomy({
        id: fixture.product.id,
        handle: fixture.product.handle,
        title: fixture.product.title,
        tags: fixture.product.tags,
      });
      assert(
        classification.ruleId === fixture.product.expectedRule,
        `${fixture.name}: expected ${fixture.product.expectedRule}, got ${classification.ruleId}.`,
      );
      if (fixture.product.expectedAudience) {
        assert(
          classification.audience?.id === fixture.product.expectedAudience,
          `${fixture.name}: expected audience ${fixture.product.expectedAudience}, got ${classification.audience?.id}.`,
        );
      } else {
        assert(
          classification.audience?.id === "unisex",
          `${fixture.name}: incidental audience evidence resolved to ${classification.audience?.id}.`,
        );
        assert(
          !classification.proposedTags.some((tag) => /^(women|men|kids)$/.test(tag)),
          `${fixture.name}: proposed tags contain an incidental audience tag.`,
        );
      }

      const plan = await buildSeoBatchPlan([rowFor(fixture.product)], {
        products: [],
        collections: [],
        collectionProducts: [],
        resolveCategoryId: async () => null,
        knowledgeModel: model,
      });
      const profile = plan.products[0];
      const title = profile?.intelligence?.canonicalTitle || profile?.productInput?.title || "";
      const body =
        profile?.intelligence?.canonicalDescriptionHtml ||
        profile?.productInput?.descriptionHtml ||
        "";
      assert(
        fixture.product.expectedTitle.test(title),
        `${fixture.name}: generated title is not product-specific: ${title}`,
      );
      for (const pattern of fixture.product.expectedBody) {
        assert(pattern.test(body), `${fixture.name}: description is missing ${pattern}.`);
      }
      if (fixture.product.forbiddenBody) {
        assert(!fixture.product.forbiddenBody.test(body), `${fixture.name}: description contains ${fixture.product.forbiddenBody}.`);
      }
      assert(
        !/Brand Name:|Choice:|High Concerned Chemical:|Origin:|Model Number:/i.test(body),
        `${fixture.name}: supplier-only metadata leaked into customer description.`,
      );
      assert(
        !/serves the specific function identified|confirmed product facts and available options/i.test(
          body,
        ),
        `${fixture.name}: generic fallback copy leaked into customer description.`,
      );
      if (fixture.product.requireModel !== false) {
        assert(
          profile.intelligence?.knowledge?.modelEvidenceUsed === true,
          `${fixture.name}: reliable 256M model evidence was not consumed by listing generation.`,
        );
      }
    } catch (error) {
      failures.push(error.message);
    }
  }

  try {
    catalogAudit = await auditLiveCatalog(model);
    for (const failure of catalogAudit.failures || []) failures.push(`catalog audit: ${failure}`);
  } catch (error) {
    failures.push(`catalog audit failed: ${error.message}`);
    catalogAudit = { status: "failed", failures: [error.message] };
  }

  const report = {
    status: failures.length ? "failed" : "verified",
    modelRecords: Number(model.trainingRecords),
    representativeRules: Number(model.representativeRules),
    representativeDocuments: Number(model.representativeDocuments),
    fixtures: fixtures.length,
    catalogAudit,
    failures,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
