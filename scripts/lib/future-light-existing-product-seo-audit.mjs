import {
  auditProductSeoRecords,
  buildProductSeoRecord,
  stripHtml,
} from "./future-light-product-seo.mjs";
import { fingerprintSeoSource } from "./seo-source-freshness.mjs";
import { SHOPIFY_ALL_PRODUCT_STATUS_FILTER } from "./shopify-product-status-scope.mjs";

const REQUIRED_COVERAGE = [
  "products",
  "productStatuses",
  "productVariants",
  "productMedia",
  "variantMediaAssociations",
  "productMetafields",
  "productMetafieldReferences",
  "collectionMemberships",
  "resourcePublications",
];

function nodes(connection) {
  if (Array.isArray(connection)) return connection;
  if (Array.isArray(connection?.nodes)) return connection.nodes;
  if (Array.isArray(connection?.edges)) return connection.edges.map((edge) => edge?.node).filter(Boolean);
  return [];
}

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function assertSnapshot(snapshot, { expectedShopDomain, now, maxAgeMs }) {
  if (snapshot?.schemaVersion !== 2) throw new Error("SEO audit requires a schemaVersion 2 Shopify snapshot.");
  if (snapshot?.shopDomain !== expectedShopDomain) {
    throw new Error(`SEO audit target mismatch: expected ${expectedShopDomain}, received ${snapshot?.shopDomain || "<missing>"}.`);
  }
  if (snapshot?.scope !== "all Shopify product statuses" || snapshot?.queryFilters?.products !== SHOPIFY_ALL_PRODUCT_STATUS_FILTER) {
    throw new Error("SEO audit requires the explicit, complete all-status Shopify product scope.");
  }
  for (const key of REQUIRED_COVERAGE) {
    if (snapshot?.coverage?.[key] !== "complete") throw new Error(`SEO audit snapshot has incomplete ${key} coverage.`);
  }
  const createdAt = Date.parse(snapshot?.createdAt || "");
  if (!Number.isFinite(createdAt)) throw new Error("SEO audit snapshot is missing a valid createdAt timestamp.");
  const ageMs = now - createdAt;
  if (ageMs < -5 * 60_000) throw new Error("SEO audit snapshot timestamp is unexpectedly in the future.");
  if (ageMs > maxAgeMs) throw new Error(`SEO audit snapshot is stale (${Math.round(ageMs / 60_000)} minutes old; maximum ${Math.round(maxAgeMs / 60_000)}).`);
  if (!Array.isArray(snapshot?.products) || snapshot.products.length !== Number(snapshot?.counts?.products)) {
    throw new Error("SEO audit snapshot product rows do not match the reconciled product count.");
  }
  const ids = new Set();
  const handles = new Set();
  const statuses = new Set(["ACTIVE", "DRAFT", "ARCHIVED", "UNLISTED"]);
  for (const product of snapshot.products) {
    if (!product?.id || !product?.handle || !statuses.has(product?.status)) {
      throw new Error("SEO audit snapshot contains a product with missing identity or an unsupported status.");
    }
    if (ids.has(product.id) || handles.has(product.handle)) {
      throw new Error(`SEO audit snapshot contains a duplicate product identity (${product.id} / ${product.handle}).`);
    }
    ids.add(product.id);
    handles.add(product.handle);
  }
}

function optionSummary(product) {
  const variants = nodes(product?.variants);
  const valuesByName = new Map();
  for (const variant of variants) {
    for (const option of variant?.selectedOptions || []) {
      const name = normalize(option?.name);
      const value = normalize(option?.value);
      if (!name || !value) continue;
      if (!valuesByName.has(name)) valuesByName.set(name, new Set());
      valuesByName.get(name).add(value);
    }
  }
  return {
    variantCount: variants.length,
    optionGroups: [...valuesByName].map(([name, values]) => ({ name, values: [...values].sort() })),
  };
}

function currentCopyIssues(product) {
  const issues = [];
  if (!normalize(product?.seo?.title)) issues.push("missing-seo-title");
  if (!normalize(product?.seo?.description)) issues.push("missing-seo-description");
  if (!normalize(product?.productType)) issues.push("missing-product-type");
  if (!product?.category?.id) issues.push("missing-shopify-category");
  if (!normalize(product?.descriptionHtml)) issues.push("missing-description");
  return issues;
}

export function buildFutureLightExistingProductSeoAudit(
  snapshot,
  {
    expectedShopDomain = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com",
    now = Date.now(),
    maxAgeMs = 30 * 60_000,
    snapshotSha256 = "",
  } = {},
) {
  assertSnapshot(snapshot, { expectedShopDomain, now, maxAgeMs });
  const activeProducts = snapshot.products.filter((product) => product.status === "ACTIVE");
  const seoRecords = activeProducts.map((product) => {
    const record = buildProductSeoRecord(product);
    record.title = String(product.title || "");
    record.seoTitle = String(product.seo?.title || "");
    record.seoDescription = String(product.seo?.description || "");
    record.descriptionHtml = String(product.descriptionHtml || "");
    return record;
  });
  const ruleAudit = auditProductSeoRecords(seoRecords);
  const issueByHandle = new Map(activeProducts.map((product) => [product.handle, new Set()]));
  for (const issue of ruleAudit.issues) {
    const separator = issue.lastIndexOf(":");
    const handle = issue.slice(0, separator);
    const code = issue.slice(separator + 1);
    issueByHandle.get(handle)?.add(code);
  }

  const activeRows = activeProducts.map((product, index) => {
    const record = seoRecords[index];
    const issues = issueByHandle.get(product.handle) || new Set();
    for (const code of currentCopyIssues(product)) issues.add(code);
    let sourceFingerprint = "";
    try {
      sourceFingerprint = fingerprintSeoSource(product).sourceFingerprint;
    } catch {
      issues.add("incomplete-seo-source-preimage");
    }
    const productMedia = nodes(product.media);
    const assignedCollections = nodes(product.collections);
    const row = {
      productId: product.id,
      legacyResourceId: String(product.legacyResourceId || ""),
      handle: product.handle,
      status: product.status,
      updatedAt: product.updatedAt || "",
      current: {
        title: String(product.title || ""),
        productType: String(product.productType || ""),
        category: product.category || null,
        seoTitle: String(product.seo?.title || ""),
        seoDescription: String(product.seo?.description || ""),
        descriptionHtml: String(product.descriptionHtml || ""),
        descriptionText: stripHtml(product.descriptionHtml || ""),
      },
      variants: optionSummary(product),
      media: {
        count: productMedia.length,
        firstImages: productMedia.slice(0, 12).map((media) => ({
          id: media.id || "",
          alt: String(media.alt || media.image?.altText || ""),
          mediaContentType: media.mediaContentType || "",
          status: media.status || "",
        })),
      },
      collections: assignedCollections.map((collection) => ({
        id: collection.id || "",
        handle: collection.handle || "",
        title: collection.title || "",
      })),
      inferredFamilyForReview: record.classification?.familyId || "",
      categoryConflictNeedsReview: record.classification?.reviewRequired === true,
      sourceFingerprint,
      issues: [...issues].sort(),
      decision: issues.size ? "review" : "preserve-candidate",
    };
    return row;
  });

  const issueCounts = {};
  const productsByIssue = {};
  for (const product of activeRows) {
    for (const code of product.issues) {
      increment(issueCounts, code);
      if (!productsByIssue[code]) productsByIssue[code] = [];
      productsByIssue[code].push(product.handle);
    }
  }
  const statuses = {};
  for (const product of snapshot.products) increment(statuses, product.status);
  return {
    schemaVersion: "2026-09-26.future-light-existing-product-seo-audit.1",
    generatedAt: new Date(now).toISOString(),
    readOnly: true,
    remoteMutationPerformed: false,
    targetShopDomain: snapshot.shopDomain,
    snapshot: {
      createdAt: snapshot.createdAt,
      sha256: snapshotSha256,
      counts: snapshot.counts,
      statuses,
      coverage: snapshot.coverage,
    },
    policy: {
      scope: "existing ACTIVE Shopify products only",
      newProductsAdded: false,
      gptCopyGenerated: false,
      seoCopyWritten: false,
      categoryOrMetafieldWritten: false,
      imagesChanged: false,
    },
    summary: {
      activeProducts: activeRows.length,
      reviewProducts: activeRows.filter((product) => product.decision === "review").length,
      preserveCandidates: activeRows.filter((product) => product.decision === "preserve-candidate").length,
      missingSeoTitle: issueCounts["missing-seo-title"] || 0,
      missingSeoDescription: issueCounts["missing-seo-description"] || 0,
      missingProductType: issueCounts["missing-product-type"] || 0,
      missingCategory: issueCounts["missing-shopify-category"] || 0,
      duplicateTitleGroups: ruleAudit.duplicateTitles,
      duplicateSeoDescriptionGroups: ruleAudit.duplicateDescriptions,
      duplicateBodyGroups: ruleAudit.duplicateDescriptionHtml,
      issueCounts,
    },
    products: activeRows,
    handlesByIssue: productsByIssue,
  };
}
