#!/usr/bin/env node

/**
 * Build a Google Merchant Center XML preview from live Shopify data.
 *
 * The command requires an explicit, evidence-backed approval manifest. It does
 * not upload the feed, enable ads, or use generated/fallback catalog files.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createShopifyAdminGraphQLClient } from "./shopify-admin-graphql-client.mjs";
import { readApprovalManifest } from "./lib/marketing-cohort-approval.mjs";

const rootDir = resolve(import.meta.dirname, "..");
const manifestPath = resolve(
  rootDir,
  process.argv
    .find((argument) => argument.startsWith("--approval-file="))
    ?.slice("--approval-file=".length) || "docs/marketing-cohort-approval.json",
);
const outputPath = resolve(rootDir, "output", "marketing-google-feed-preview.xml");

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numericId(value) {
  return String(value ?? "").match(/\d+$/)?.[0] || String(value ?? "");
}

function feedItem(product, variant) {
  const title = `${product.title}${variant.title && variant.title !== "Default Title" ? ` — ${variant.title}` : ""}`;
  const description = stripHtml(product.descriptionHtml).slice(0, 5_000);
  const rawInventory = variant.inventoryQuantity;
  const inventory = Number(rawInventory);
  if (
    rawInventory === null ||
    rawInventory === undefined ||
    rawInventory === "" ||
    !Number.isFinite(inventory)
  ) {
    throw new Error(
      `${product.handle}/${variant.id}: inventory is unknown; refusing to advertise it`,
    );
  }
  const price = Number(variant.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`${product.handle}/${variant.id}: price is invalid`);
  }
  if (!product.onlineStoreUrl || !product.featuredImage?.url) {
    throw new Error(`${product.handle}: live product URL and image are required`);
  }
  const id = numericId(variant.id);
  const item = [
    "    <item>",
    `      <g:id>${escapeXml(id)}</g:id>`,
    `      <g:item_group_id>${escapeXml(numericId(product.id))}</g:item_group_id>`,
    `      <g:title>${escapeXml(title.slice(0, 150))}</g:title>`,
    `      <g:description>${escapeXml(description || title)}</g:description>`,
    `      <g:link>${escapeXml(product.onlineStoreUrl)}</g:link>`,
    `      <g:image_link>${escapeXml(product.featuredImage.url)}</g:image_link>`,
    `      <g:availability>${inventory > 0 ? "in stock" : "out of stock"}</g:availability>`,
    `      <g:price>${price.toFixed(2)} USD</g:price>`,
    `      <g:condition>new</g:condition>`,
    `      <g:brand>${escapeXml(product.vendor || "VS Store")}</g:brand>`,
    "      <g:identifier_exists>false</g:identifier_exists>",
    "      <g:custom_label_0>vs-store-approved-cohort</g:custom_label_0>",
    "    </item>",
  ];
  return item.join("\n");
}

export function buildFeedXml(products) {
  const items = products.flatMap((product) =>
    (product.variants?.nodes || []).map((variant) => feedItem(product, variant)),
  );
  if (!items.length) throw new Error("No live variants were available for the feed");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    "  <channel>",
    "    <title>VS Store approved product cohort</title>",
    "    <link>https://vs-store-us.myshopify.com</link>",
    "    <description>Live Shopify product feed preview for the approved VS Store cohort.</description>",
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

async function main() {
  let approval;
  try {
    approval = await readApprovalManifest(manifestPath);
  } catch (error) {
    throw new Error(
      `Approval manifest is missing or unreadable at ${manifestPath}. Copy docs/marketing-cohort-approval.example.json, complete it, and rerun: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (approval.errors.length) {
    throw new Error(`Approval manifest is not ready:\n- ${approval.errors.join("\n- ")}`);
  }

  const client = createShopifyAdminGraphQLClient({
    rootDir,
    agentName: "marketing-google-feed-preview",
  });
  const products = [];
  for (const handle of approval.handles) {
    const data = await client.run(
      `query ProductByHandle($query: String!) {
        products(first: 1, query: $query) {
          nodes {
            id
            title
            handle
            descriptionHtml
            vendor
            onlineStoreUrl
            featuredImage { url altText }
            variants(first: 100) {
              nodes { id title price inventoryQuantity }
            }
          }
        }
      }`,
      { query: `status:ACTIVE AND handle:${handle}` },
      { operation: `Read live approved product ${handle} for Merchant Center preview` },
    );
    const product = data.products?.nodes?.[0];
    if (!product || product.handle !== handle) {
      throw new Error(`${handle}: active live Shopify product was not found`);
    }
    products.push(product);
  }

  await mkdir(resolve(rootDir, "output"), { recursive: true });
  await writeFile(outputPath, buildFeedXml(products), "utf8");
  process.stdout.write(
    `Google Merchant feed preview written to ${outputPath}\n` +
      `Live products: ${products.length}; live variants: ${products.reduce((sum, product) => sum + (product.variants?.nodes?.length || 0), 0)}. Upload is not performed.\n`,
  );
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : error}\n`);
    process.exitCode = 1;
  });
}
