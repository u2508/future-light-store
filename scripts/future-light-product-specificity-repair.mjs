#!/usr/bin/env node

/*
 * Targeted Future Light product-copy repair. Only the exact handles below are
 * eligible; price, inventory, media, and variants are never sent in the
 * mutation input.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { FUTURE_LIGHT_BRAND, FUTURE_LIGHT_SHOP_DOMAIN } from "./lib/product-image-health.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const verifyPath = resolve(rootDir, "output/future-light-product-specificity-live-verify.json");
const outputDir = resolve(rootDir, "output/future-light-product-specificity-repair");
const manifestPath = resolve(outputDir, "manifest.json");

const REPAIRS = new Map([
  [
    "ovw-makeup-brushes-set-professional-goat-hair-makeup-brushes-set-eye-shadow-blending-eyeliner-eyelash-eyebrow-brush-for-makeup",
    {
      title: "OVW Goat-Hair Makeup Brush Set, 6–24 Pieces",
      seoTitle: "OVW Goat-Hair Makeup Brush Set 6–24 Pieces",
      seoDescription: "Build an eye and complexion routine with this OVW goat-hair brush set. Choose 6, 9, 18, or 24 pieces; select sets include a makeup bag for storage and travel.",
      descriptionHtml: "<h2>About OVW Goat-Hair Makeup Brush Set, 6–24 Pieces</h2>\n<p><strong>OVW Goat-Hair Makeup Brush Set, 6–24 Pieces</strong> &mdash; Build an eye and complexion routine with this OVW goat-hair brush set. Choose 6, 9, 18, or 24 pieces; select sets include a makeup bag for storage and travel.</p>\n<h3>Choose your set</h3>\n<ul><li>6-, 9-, 18-, or 24-piece options</li><li>Goat-hair brushes for eye, foundation, blending, liner, lash, and brow work</li><li>Select options include a makeup bag</li></ul>\n<h3>Use &amp; Care</h3>\n<p>Use each brush for its intended makeup step, clean it after use, and let the bristles dry fully before storing.</p>",
    },
  ],
  [
    "tinted-mositure-blush-stick-face-pink-cream-cheek-blusher-cosmetics-3-in-1-makeup-tubes-used-on-lips-eyes-cheeks",
    {
      title: "3-in-1 Tinted Blush Stick for Lips, Eyes & Cheeks",
      seoTitle: "3-in-1 Tinted Blush Stick for Lips Eyes and Cheeks",
      seoDescription: "Add color to lips, eyes, or cheeks with this 3-in-1 tinted blush stick. Its cream format is easy to carry for quick touch-ups; choose a shade before checkout.",
      descriptionHtml: "<h2>About 3-in-1 Tinted Blush Stick for Lips, Eyes &amp; Cheeks</h2>\n<p><strong>3-in-1 Tinted Blush Stick for Lips, Eyes &amp; Cheeks</strong> &mdash; Add color to lips, eyes, or cheeks with this cream blush stick. Choose the shade that fits your look and keep it close for quick touch-ups.</p>\n<h3>Why it belongs in your makeup bag</h3>\n<ul><li>One stick for lips, eyes, and cheeks</li><li>Cream format for light, buildable color</li><li>Portable for quick touch-ups</li><li>Choose from the listed shade options</li></ul>\n<h3>Use &amp; Care</h3>\n<p>Apply lightly to the cheek, lip, or eye area and build gradually. Keep the stick clean and dry between uses.</p>",
    },
  ],
  [
    "super-bunch-new-l-curl-mink-false-eyelash-60-clusters-lashtray-makeup-20d-eyelashes-extensions-individual-handmade-eye-lashes",
    {
      title: "Super Bunch L-Curl Cluster Lashes, 60-Piece Set",
      seoTitle: "Super Bunch L-Curl Cluster Lashes 60-Piece Set",
      seoDescription: "Super Bunch L-curl cluster lashes come in a 60-piece set with 0.07 mm thickness and lengths from 8 to 16 mm. Select your preferred length before ordering.",
      descriptionHtml: "<h2>About Super Bunch L-Curl Cluster Lashes, 60-Piece Set</h2>\n<p><strong>Super Bunch L-Curl Cluster Lashes, 60-Piece Set</strong> &mdash; Create a more defined eye look with Super Bunch L-Curl cluster lashes. Each set includes 60 pieces in 0.07 mm, with length options from 8 to 16 mm.</p>\n<h3>What to expect</h3>\n<ul><li>60-piece cluster lash set</li><li>L-Curl style</li><li>0.07 mm thickness</li><li>Choose from 8 to 16 mm lengths</li></ul>\n<h3>Use &amp; Care</h3>\n<p>Select your preferred length, then apply and remove the lashes according to the supplied directions for your chosen look.</p>",
    },
  ],
  [
    "lakerain-honey-lipstick-long-lasting-moisturizing-natural-lip-plumper-makeup-lip-plumping-gloss-cosmetics-for-lip",
    {
      title: "Lakerain Honey Matte Lipstick, Multiple Shades",
      seoTitle: "Lakerain Honey Matte Lipstick Multiple Shades",
      seoDescription: "Lakerain Honey matte lipstick comes in pink, nude, brown, and deeper shade options for everyday lip color. Choose the shade that suits your look before checkout.",
      descriptionHtml: "<h2>About Lakerain Honey Matte Lipstick, Multiple Shades</h2>\n<p><strong>Lakerain Honey Matte Lipstick, Multiple Shades</strong> &mdash; Add an easy pop of color with Lakerain Honey matte lipstick. Choose the shade that fits your look, from soft pink to nude, brown, or a deeper tone.</p>\n<h3>Why it belongs in your makeup bag</h3>\n<ul><li>Matte lipstick for everyday makeup</li><li>Pink, nude, brown, and deeper shade options</li><li>Easy to carry for quick touch-ups</li><li>Apply a light layer or build more coverage</li></ul>\n<h3>Use &amp; Care</h3>\n<p>Apply to clean lips and build as desired. Remove it during your usual makeup-cleansing routine.</p>",
    },
  ],
  [
    "herorange-12-color-eyeshadow-palette-fine-texture-rich-pigment-matte-shimmer-glitter-portable-with-mirror",
    {
      title: "Herorange 12-Color Eyeshadow Palette with Mirror",
      seoTitle: "Herorange 12-Color Eyeshadow Palette with Mirror",
      seoDescription: "Herorange 12-color eyeshadow palette for everyday or statement looks. Choose shade 01 or 02; each compact includes 12g, matte, shimmer, glitter finishes, and a mirror.",
      descriptionHtml: "<h2>About Herorange 12-Color Eyeshadow Palette with Mirror</h2>\n<p><strong>Herorange 12-Color Eyeshadow Palette with Mirror</strong> &mdash; Create soft daytime looks or build more intensity for evening with this portable 12-color palette.</p>\n<h3>What to expect</h3>\n<ul><li>12 shades in each palette</li><li>12g format for your everyday routine</li><li>Choose shade option 01 or 02</li><li>Matte, shimmer, and glitter finish options with a mirror</li></ul>\n<h3>Use &amp; Care</h3>\n<p>Apply and blend according to the eye look you want, then close the palette and keep it clean between uses.</p>",
    },
  ],
]);

const PRODUCT_QUERY = /* GraphQL */ `
  query FutureLightSpecificityRepairRead($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product { id handle title descriptionHtml vendor status seo { title description } }
    }
  }
`;
const PRODUCT_UPDATE_MUTATION = /* GraphQL */ `
  mutation FutureLightSpecificityRepair($id: ID!, $title: String!, $seoTitle: String!, $seoDescription: String!, $descriptionHtml: String!) {
    productUpdate(product: { id: $id, title: $title, descriptionHtml: $descriptionHtml, seo: { title: $seoTitle, description: $seoDescription } }) {
      product { id handle title vendor status seo { title description } }
      userErrors { field message }
    }
  }
`;

function normalize(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function normalizeMarkup(value) {
  return String(value ?? "")
    .replace(/&mdash;|&#8212;|&#x2014;/gi, "—")
    .replace(/&amp;|&#38;|&#x26;/gi, "&")
    .replace(/&apos;|&#39;|&#x27;/gi, "'")
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .trim();
}
async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }

async function main() {
  const apply = process.argv.includes("--apply");
  const verify = await readJson(verifyPath);
  if (verify.targetStoreDomain !== FUTURE_LIGHT_SHOP_DOMAIN || verify.liveMutation !== false) throw new Error("Refused a non-read-only or wrong-target specificity manifest.");
  const targets = (verify.products || []).filter((product) => REPAIRS.has(product.handle));
  if (targets.length !== REPAIRS.size) throw new Error(`Expected ${REPAIRS.size} targeted live products in the current verify manifest; found ${targets.length}.`);
  const client = createShopifyAdminGraphQLClient({ rootDir, agentName: "future-light-product-specificity-repair" });
  const retryInfo = [];
  const read = await client.run(PRODUCT_QUERY, { ids: targets.map((product) => product.gid || `gid://shopify/Product/${product.id}`) }, { operation: "read targeted Future Light SEO repairs", retryInfo });
  const liveByHandle = new Map((read.nodes || []).filter(Boolean).map((product) => [product.handle, product]));
  const entries = [];
  for (const target of targets) {
    const product = liveByHandle.get(target.handle);
    const desired = REPAIRS.get(target.handle);
    if (!product) throw new Error(`Target product missing from live readback: ${target.handle}`);
    if (normalize(product.vendor) !== FUTURE_LIGHT_BRAND || normalize(product.status).toUpperCase() !== "ACTIVE") throw new Error(`Refused non-active/non-VS Store product: ${target.handle}`);
    const changedFields = [
      ["title", normalize(product.title), normalize(desired.title)],
      ["seoTitle", normalize(product.seo?.title || product.title), normalize(desired.seoTitle)],
      ["seoDescription", normalize(product.seo?.description), normalize(desired.seoDescription)],
      ["descriptionHtml", normalizeMarkup(product.descriptionHtml), normalizeMarkup(desired.descriptionHtml)],
    ].filter(([, actual, expected]) => actual !== expected).map(([field]) => field);
    const entry = {
      handle: product.handle,
      productId: product.id,
      titleBefore: product.title,
      seoTitleBefore: product.seo?.title || "",
      seoDescriptionBefore: product.seo?.description || "",
      descriptionHtmlBefore: product.descriptionHtml || "",
      titleAfter: desired.title,
      seoTitleAfter: desired.seoTitle,
      seoDescriptionAfter: desired.seoDescription,
      changed: changedFields.length > 0,
      changedFields,
      status: apply ? "pending" : "dry_run",
    };
    if (apply && entry.changed) {
      const result = await client.run(PRODUCT_UPDATE_MUTATION, {
        id: product.id,
        title: desired.title,
        seoTitle: desired.seoTitle,
        seoDescription: desired.seoDescription,
        descriptionHtml: desired.descriptionHtml,
      }, { allowMutations: true, operation: `repair final product copy ${product.handle}`, retryInfo });
      const payload = result?.productUpdate;
      if (payload?.userErrors?.length) throw new Error(`${product.handle}: ${payload.userErrors.map((error) => error.message).join(" | ")}`);
      if (!payload?.product?.id) throw new Error(`${product.handle}: Shopify returned no updated product`);
      const readback = await client.run(PRODUCT_QUERY, { ids: [product.id] }, { operation: `read back repaired SEO description ${product.handle}`, retryInfo });
      const actual = readback.nodes?.find((candidate) => candidate?.id === product.id);
      if (normalize(actual?.title) !== normalize(desired.title)
        || normalize(actual?.seo?.title || actual?.title) !== normalize(desired.seoTitle)
        || normalize(actual?.seo?.description) !== normalize(desired.seoDescription)
        || normalizeMarkup(actual?.descriptionHtml) !== normalizeMarkup(desired.descriptionHtml)) throw new Error(`${product.handle}: final product copy readback mismatch`);
      entry.status = "updated_verified";
      entry.titleAfter = actual.title;
    } else if (entry.changed) {
      entry.status = "would_update";
    } else {
      entry.status = "already_aligned";
    }
    entries.push(entry);
  }
  const manifest = {
    schemaVersion: "2026-09-17.future-light-product-specificity-repair.1",
    targetStoreDomain: FUTURE_LIGHT_SHOP_DOMAIN,
    scope: "five exact product-copy corrections only",
    apply,
    liveMutation: apply && entries.some((entry) => entry.status === "updated_verified"),
    retryInfo,
    entries,
    summary: {
      targeted: entries.length,
      updatedVerified: entries.filter((entry) => entry.status === "updated_verified").length,
      wouldUpdate: entries.filter((entry) => entry.status === "would_update").length,
      alreadyAligned: entries.filter((entry) => entry.status === "already_aligned").length,
    },
    completedAt: new Date().toISOString(),
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`Future Light targeted product-copy repair: ${manifest.summary.updatedVerified} updated and verified, ${manifest.summary.wouldUpdate} would update, ${manifest.summary.alreadyAligned} already aligned. ${apply ? "Only the exact title, SEO fields, and descriptionHtml payloads were mutated." : "Dry-run; no Shopify mutation."}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
