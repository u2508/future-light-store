import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import policy from "../config/dsers-family-store-search-policy.json" with { type: "json" };

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("DOCX allocation is a planning ceiling and all lane slots reconcile", () => {
  assert.equal(policy.productTarget, 3000);
  assert.equal(policy.planningSlots, 679);
  assert.equal(policy.planningSlotsAreCeiling, true);
  assert.equal(policy.collectionLanes.length, 10);
  assert.equal(
    policy.collectionLanes.reduce((sum, lane) => sum + lane.slots, 0),
    679,
  );
  assert.equal(policy.existingShopifyProductsAreNotNewCandidates, true);
});

test("source lane descriptions and selection intents are retained verbatim", () => {
  assert.deepEqual(
    policy.collectionLanes.map(({ name, slots, whatBelongsHere }) => [name, slots, whatBelongsHere]),
    [
      ["Kids toys & toddler learning", 80, "Learning, sensory, pretend play, outdoor-safe play"],
      ["Baby care & baby wear", 60, "Non-medical care, clothing, feeding and nursery organization"],
      ["Women beauty & hair care", 70, "Cosmetic tools, organizers, hair accessories and non-medical care"],
      ["Women fashion & accessories", 60, "Wearable, giftable, non-repair fashion"],
      ["Men fashion & accessories", 50, "Belts, wallets, bags, watches and casual accessories"],
      ["Anime, manga & collectibles", 60, "Display-safe figures, desk collectibles, hobby gifts"],
      ["Pet essentials", 80, "Non-medical toys, grooming, walking and feeding accessories"],
      ["Safe electronics accessories", 75, "Passive cables, holders, cases, stands and desk accessories"],
      ["Home, decor & bedding", 70, "Storage, textiles, table, wall and small-space decor"],
      ["Gaming, watches & utility", 74, "Controllers without batteries, watch accessories and everyday utility"],
    ],
  );
  assert.deepEqual(
    policy.searchFamilies.map(({ selectionIntent }) => selectionIntent),
    [
      "Prioritize clear age range, non-toxic/material evidence, complete sets and stock ≥200.",
      "Exclude medical claims, sleep-positioning products, unsafe cords and unclear age/safety details.",
      "Use beauty-tool and organizer terms; reject unsupported treatment, medical or guaranteed-result claims.",
      "Prefer durable, non-repair, giftable accessories with readable color/size variants.",
      "Keep actual gender/use clear; do not assign men/women labels from generic product metadata alone.",
      "No weapons, adult content, counterfeit branding or fragile items with ambiguous licensing evidence.",
      "Exclude medication, medical devices and dangerous chew/toy claims; check material and size clarity.",
      "Passive accessory only. Reject batteries, power banks, chargers with unclear certification, logic boards and repair parts.",
      "Prioritize dimensional clarity, material evidence, complete-set contents and clean lifestyle imagery.",
      "No battery-powered controllers or electronics; keep variant names human-readable and organized.",
    ],
  );
});

test("seven source batches and joint lane allocations reconcile to the same 679-slot ceiling", () => {
  const families = new Set(policy.searchFamilies.map((family) => family.name));
  const laneTotals = new Map(policy.collectionLanes.map(({ id }) => [id, 0]));
  assert.equal(policy.batches.length, 7);
  assert.equal(
    policy.batches.reduce((sum, batch) => sum + batch.ceiling, 0),
    679,
  );
  for (const batch of policy.batches) {
    assert.ok(batch.families.length > 0);
    assert.equal(batch.laneAllocations.reduce((sum, allocation) => sum + allocation.slots, 0), batch.ceiling);
    for (const family of batch.families)
      assert.ok(families.has(family), `Unknown family in batch ${batch.id}: ${family}`);
    for (const allocation of batch.laneAllocations) {
      assert.ok(policy.collectionLanes.some(({ id }) => id === allocation.laneId));
      laneTotals.set(allocation.laneId, laneTotals.get(allocation.laneId) + allocation.slots);
    }
  }
  for (const lane of policy.collectionLanes) assert.equal(laneTotals.get(lane.id), lane.slots, lane.id);
  assert.deepEqual(
    policy.batches.map(({ sourceLane, ceiling, sourceGate }) => [sourceLane, ceiling, sourceGate]),
    [
      ["Kids + baby", 100, "Validate family safety, age/size evidence and non-medical language."],
      ["Beauty + hair", 100, "Tools and organizers first; reject treatment/guarantee claims."],
      ["Women + men accessories", 100, "Readable wearable variants and no gender misclassification."],
      ["Pets", 100, "Manual grooming, walking, feeding and enrichment only."],
      ["Safe electronics accessories", 100, "Passive products only; no batteries, chargers or boards."],
      ["Home + decor + bedding", 100, "Material, dimensions, set contents and lifestyle relevance."],
      ["Anime + gaming + watches + utility", 79, "Collectible, display and passive utility products; licensing and safety checks."],
    ],
  );
  assert.deepEqual(
    policy.batches.map((batch) => batch.laneAllocations.map(({ laneId, slots }) => [laneId, slots])),
    [
      [["kids-toddler-learning", 80], ["baby-care-wear", 20]],
      [["baby-care-wear", 40], ["women-beauty-hair", 60]],
      [["women-beauty-hair", 10], ["women-fashion-accessories", 60], ["men-fashion-accessories", 30]],
      [["men-fashion-accessories", 20], ["pet-essentials", 80]],
      [["safe-electronics-accessories", 75], ["home-decor-bedding", 25]],
      [["home-decor-bedding", 45], ["anime-manga-collectibles", 55]],
      [["anime-manga-collectibles", 5], ["gaming-watches-utility", 74]],
    ],
  );
});

test("all search families have unique terms and valid collection lanes", () => {
  const lanes = new Set(policy.collectionLanes.map((lane) => lane.id));
  const terms = [];
  for (const family of policy.searchFamilies) {
    assert.ok(lanes.has(family.laneId), `Unknown lane for ${family.name}`);
    assert.ok(family.terms.length > 0, `No search terms for ${family.name}`);
    terms.push(...family.terms.map((term) => term.toLowerCase()));
  }
  assert.equal(
    new Set(terms).size,
    terms.length,
    "Search terms must not be duplicated across families",
  );
  assert.ok(terms.includes("dog grooming slicker brush"));
  assert.ok(terms.includes("usb c cable passive"));
  assert.ok(terms.includes("stainless steel necklace women"));
});

test("qualification score caps match the source 100-point rubric and no undocumented threshold is invented", () => {
  const score = policy.qualificationScore;
  assert.deepEqual(
    score.dimensions.map(({ max }) => max),
    [30, 20, 20, 15, 15],
  );
  assert.equal(
    score.dimensions.reduce((sum, dimension) => sum + dimension.max, 0),
    100,
  );
  assert.equal(score.minimumPassingTotal, null);
  assert.equal(score.hardExclusionsOverrideScore, true);
  assert.deepEqual(
    score.dimensions.map(({ sourceCriterion }) => sourceCriterion),
    [
      "primary image matches the product, variants are visible, dimensions/material/use are supported, and no supplier watermark or China-focused scene dominates the listing.",
      "family-safe, giftable or useful, aligned with the target collection, and easy to explain in natural language.",
      "stock ≥200, stable cost, plausible US price, healthy margin after the store overhead, and no obvious commodity race-to-the-bottom.",
      "color, size, pack count or style is shopper-readable; remove codes and preserve only meaningful option structure.",
      "enough verified facts for a product-specific title, description, FAQ, alt text and collection placement without inventing claims.",
    ],
  );
});

test("source exclusions, six operating steps, and SEO/GEO/AEO rules are preserved", () => {
  assert.deepEqual(policy.sourceHardExclusions, [
    "Batteries, rechargeable cells, power banks, portable chargers, battery packs and products whose core function depends on an unverified battery.",
    "Logic boards, bare boards, replacement boards, repair parts, spare assemblies and products marketed for device repair.",
    "Medical devices, diagnostic claims, supplements, ingestibles, medication, cosmetic claims that promise treatment or guaranteed outcomes.",
    "Adult, erotic, sexual-wellness, fetish, weapon, tactical weapon, counterfeit, trademark-infringing or licensed-character items without credible evidence.",
    "Products with stock below 200, missing price/cost, missing images, unusable images, unclear variant mapping or materially misleading supplier copy.",
    "Duplicate products already pushed to Shopify, near-duplicates with no meaningful differentiation, and variants whose names expose supplier SKU codes instead of shopper-readable attributes.",
  ]);
  assert.deepEqual(policy.operatingSequence, [
    "Search one family at a time and keep the active filters visible: US target, stock ≥200, family-store category, no prohibited electronics or repair products.",
    "Review primary/variant images before selection. Keep strong product images; hold or reject items where the image shows a different product, unsafe context, supplier branding or a misleading variant.",
    "Check supplier cost, US price, stock, shipping signal and variant names. Do not import code-only options such as TK-0000007129 unless the shopper-facing attribute is also present and clear.",
    "Check for duplicates against the existing Shopify catalog and the DSers My Products list before adding to Import List.",
    "Add in controlled batches, then use Import Reviews and Shopify readback. Skip any item whose push result is partial, errored or mismatched.",
    "After Shopify readback, route each product into one primary collection and optional secondary merchandising tags. Keep taxonomy and customer-facing copy synchronized.",
  ]);
  assert.deepEqual(Object.keys(policy.copyRules.sourceSeoGeoAeo), [
    "title", "description", "facts", "questions", "geoAeo", "imageAlt",
  ]);
  assert.equal(policy.copyRules.sourceSeoGeoAeo.title.includes("remove supplier years"), true);
  assert.equal(policy.copyRules.sourceSeoGeoAeo.description.includes("specific function identified by its handle"), true);
  assert.equal(policy.copyRules.sourceSeoGeoAeo.facts.includes("Normalize HTML entities"), true);
  assert.equal(policy.copyRules.sourceSeoGeoAeo.questions.includes("without inventing certifications"), true);
  assert.equal(policy.copyRules.sourceSeoGeoAeo.geoAeo.includes("clean internal links"), true);
  assert.equal(policy.copyRules.sourceSeoGeoAeo.imageAlt.includes("hold the product for visual review"), true);
});

test("machine policy stays byte-linked to the supplied DOCX source", async () => {
  const source = await readFile(resolve(rootDir, policy.sourceDocument));
  const digest = createHash("sha256").update(source).digest("hex");
  assert.equal(digest, policy.sourceSha256);
});
