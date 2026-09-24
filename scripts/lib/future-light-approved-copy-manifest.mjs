import { createHash } from "node:crypto";

export const FUTURE_LIGHT_SHOP_DOMAIN = "vs-future-store-0jl2t-jxu6tnr3.myshopify.com";
export const APPROVED_COPY_FIELDS = Object.freeze([
  "title",
  "descriptionHtml",
  "seoTitle",
  "seoDescription",
]);
export const FUTURE_LIGHT_COPY_PILOT_PRODUCT_COUNT = 10;

const DIGEST = /^[a-f0-9]{64}$/;
const PROTECTED_DECISIONS = new Set(["approved_keep", "held"]);
const ALLOWED_EVIDENCE_KINDS = new Set([
  "manufacturer-document",
  "product-image",
  "shopify-category",
  "shopify-variant",
  "supplier-specification",
  "verified-shipping",
]);

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireDigest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value), "utf8").digest("hex");
}

function copyValues(product) {
  if (typeof product?.title !== "string" || typeof product?.descriptionHtml !== "string") {
    throw new TypeError(`Product ${String(product?.id)} has no exact title or description string`);
  }
  return {
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    seoTitle: product.seo?.title ?? null,
    seoDescription: product.seo?.description ?? null,
  };
}

function validateSnapshot(snapshot, sourceSnapshotSha256, sourceSnapshotBytes) {
  if (snapshot?.shopDomain !== FUTURE_LIGHT_SHOP_DOMAIN) {
    throw new Error("Copy manifest source snapshot is not from the exact Future Light Shopify target");
  }
  if (typeof snapshot.apiVersion !== "string" || !snapshot.apiVersion) {
    throw new Error("Copy manifest source snapshot must include its Shopify API version");
  }
  if (!Array.isArray(snapshot.products) || snapshot.products.length === 0 ||
      snapshot.counts?.products !== snapshot.products.length || snapshot.coverage?.products !== "complete") {
    throw new Error("Copy manifest requires a complete product snapshot with reconciled product count");
  }
  const sourceDigest = requireDigest(sourceSnapshotSha256, "sourceSnapshotSha256");
  if (!(typeof sourceSnapshotBytes === "string" || Buffer.isBuffer(sourceSnapshotBytes) || sourceSnapshotBytes instanceof Uint8Array)) {
    throw new TypeError("sourceSnapshotBytes must contain the exact UTF-8 bytes of the frozen snapshot artifact");
  }
  const exactBytes = Buffer.isBuffer(sourceSnapshotBytes) ? sourceSnapshotBytes : Buffer.from(sourceSnapshotBytes);
  const computedDigest = createHash("sha256").update(exactBytes).digest("hex");
  if (computedDigest !== sourceDigest) throw new Error("Source snapshot digest does not match the supplied snapshot bytes");
  let parsedSnapshot;
  try {
    parsedSnapshot = JSON.parse(exactBytes.toString("utf8"));
  } catch {
    throw new Error("Source snapshot bytes are not valid UTF-8 JSON");
  }
  if (stableJson(parsedSnapshot) !== stableJson(snapshot)) {
    throw new Error("Parsed source snapshot bytes do not exactly match the supplied snapshot object");
  }
  return sourceDigest;
}

function validateClaimLedger(ledger, productId) {
  if (!Array.isArray(ledger) || ledger.length === 0) {
    throw new Error(`Rewritten product ${productId} requires a claim-by-claim evidence ledger`);
  }
  const claimIds = new Set();
  for (const claim of ledger) {
    requireText(claim?.claimId, `Claim ID for ${productId}`);
    requireText(claim?.text, `Claim text for ${productId}`);
    if (claimIds.has(claim.claimId)) throw new Error(`Duplicate claim ID ${claim.claimId} for ${productId}`);
    claimIds.add(claim.claimId);
    if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) {
      throw new Error(`Claim ${claim.claimId} for ${productId} has no independent evidence`);
    }
    const evidenceIds = new Set();
    for (const reference of claim.evidence) {
      const kind = requireText(reference?.kind, `Evidence kind for claim ${claim.claimId}`);
      if (!ALLOWED_EVIDENCE_KINDS.has(kind)) {
        throw new Error(`Evidence kind ${kind} is not an allowed independent source for claim ${claim.claimId}`);
      }
      const sourceId = requireText(reference?.sourceId, `Evidence source ID for claim ${claim.claimId}`);
      requireDigest(reference?.sourceSha256, `Evidence source SHA-256 for claim ${claim.claimId}`);
      if (evidenceIds.has(sourceId)) throw new Error(`Duplicate evidence source ${sourceId} for claim ${claim.claimId}`);
      evidenceIds.add(sourceId);
    }
  }
  return ledger.map((claim) => ({
    claimId: claim.claimId,
    text: claim.text,
    evidence: claim.evidence.map(({ kind, sourceId, sourceSha256 }) => ({ kind, sourceId, sourceSha256 })),
  }));
}

function normalizeDecision(decision, product, beforeImage) {
  const productId = requireText(decision?.productId, "Decision product ID");
  if (productId !== product.id) throw new Error(`Decision ${productId} does not match source product ${product.id}`);
  const status = decision?.decision;
  if (!new Set(["approved_keep", "needs_rewrite", "held"]).has(status)) {
    throw new Error(`Product ${productId} must be classified as approved_keep, needs_rewrite, or held`);
  }
  const reason = requireText(decision?.reason, `Decision reason for ${productId}`);
  const reviewer = requireText(decision?.reviewer, `Decision reviewer for ${productId}`);
  const evidenceFingerprint = requireDigest(decision?.evidenceFingerprint, `Evidence fingerprint for ${productId}`);
  const row = {
    productId,
    status: product.status,
    decision: status,
    reason,
    reviewer,
    evidenceFingerprint,
    beforeImage,
    beforeImageSha256: sha256(beforeImage),
  };
  if (PROTECTED_DECISIONS.has(status)) {
    if (decision.proposal !== undefined) {
      throw new Error(`${status} product ${productId} cannot contain proposed copy fields`);
    }
    if (decision.claimLedger !== undefined) {
      throw new Error(`${status} product ${productId} cannot contain a write claim ledger`);
    }
    return row;
  }

  if (!decision.proposal || typeof decision.proposal !== "object" || Array.isArray(decision.proposal)) {
    throw new Error(`Rewritten product ${productId} requires an exact copy proposal`);
  }
  const proposal = {};
  for (const [field, value] of Object.entries(decision.proposal)) {
    if (!APPROVED_COPY_FIELDS.includes(field)) throw new Error(`Copy field ${field} is not allowed for product ${productId}`);
    if (typeof value !== "string" || value.trim() === "") throw new Error(`Proposed ${field} for ${productId} must be a non-empty string`);
    if (value === beforeImage[field]) throw new Error(`Proposed ${field} for ${productId} is unchanged and must be omitted`);
    proposal[field] = value;
  }
  if (Object.keys(proposal).length === 0) throw new Error(`Rewritten product ${productId} has no changed fields`);
  row.proposal = proposal;
  row.claimLedger = validateClaimLedger(decision.claimLedger, productId);
  return row;
}

/** Build an explicitly scoped copy manifest. Existing accurate copy is protected by exact preimage. */
export function createFutureLightApprovedCopyManifest({
  snapshot,
  sourceSnapshotSha256,
  sourceSnapshotBytes,
  decisions,
  scopeProductIds,
  createdAt,
} = {}) {
  const sourceDigest = validateSnapshot(snapshot, sourceSnapshotSha256, sourceSnapshotBytes);
  requireText(createdAt, "createdAt");
  if (!Number.isFinite(Date.parse(createdAt))) throw new TypeError("createdAt must be an ISO-compatible timestamp");
  if (!Array.isArray(decisions)) throw new TypeError("Copy decisions must be an array");

  const productsById = new Map(snapshot.products.map((product) => [product.id, product]));
  if (productsById.size !== snapshot.products.length) throw new Error("Source snapshot contains duplicate product IDs");
  let scopedProductIds;
  if (scopeProductIds === undefined) {
    scopedProductIds = snapshot.products.map((product) => product.id);
  } else {
    if (!Array.isArray(scopeProductIds) || scopeProductIds.length === 0) {
      throw new TypeError("scopeProductIds must be a non-empty array when explicitly supplied");
    }
    const requestedIds = scopeProductIds.map((productId) => requireText(productId, "Scope product ID"));
    if (new Set(requestedIds).size !== requestedIds.length) throw new Error("Copy manifest scope contains duplicate product IDs");
    for (const productId of requestedIds) {
      if (!productsById.has(productId)) throw new Error(`Copy manifest scope references a product outside the frozen catalog: ${productId}`);
    }
    scopedProductIds = requestedIds;
  }
  const scopeType = scopedProductIds.length === snapshot.products.length ? "full-catalog" : "bounded-pilot";
  if (scopeType === "bounded-pilot" && scopedProductIds.length !== FUTURE_LIGHT_COPY_PILOT_PRODUCT_COUNT) {
    throw new Error(`Bounded pilot scope must contain exactly ${FUTURE_LIGHT_COPY_PILOT_PRODUCT_COUNT} products`);
  }
  const scopedProductIdSet = new Set(scopedProductIds);
  const decisionsById = new Map();
  for (const decision of decisions) {
    const productId = requireText(decision?.productId, "Decision product ID");
    if (!productsById.has(productId)) throw new Error(`Decision references a product outside the frozen catalog: ${productId}`);
    if (!scopedProductIdSet.has(productId)) throw new Error(`Decision references a product outside the declared copy-manifest scope: ${productId}`);
    if (decisionsById.has(productId)) throw new Error(`Duplicate content decision for ${productId}`);
    decisionsById.set(productId, decision);
  }
  for (const productId of scopedProductIds) {
    if (!decisionsById.has(productId)) throw new Error(`Missing content decision for ${productId}`);
  }
  if (decisionsById.size !== scopedProductIds.length) {
    throw new Error("A copy decision is required for every product in the declared manifest scope");
  }

  const products = scopedProductIds.map((productId) => normalizeDecision(
    decisionsById.get(productId),
    productsById.get(productId),
    copyValues(productsById.get(productId)),
  ));
  const manifest = {
    schemaVersion: 1,
    shopDomain: FUTURE_LIGHT_SHOP_DOMAIN,
    apiVersion: snapshot.apiVersion,
    sourceSnapshot: {
      sha256: sourceDigest,
      productCount: snapshot.products.length,
    },
    scope: {
      type: scopeType,
      productIds: scopedProductIds,
    },
    createdAt,
    products,
  };
  return Object.freeze({ ...manifest, manifestFingerprint: sha256(manifest) });
}

function indexUniqueProducts(products, label) {
  if (!Array.isArray(products)) throw new TypeError(`${label} must be an array`);
  const map = new Map();
  for (const product of products) {
    requireText(product?.id, `${label} product ID`);
    if (map.has(product.id)) throw new Error(`${label} contains duplicate product ${product.id}`);
    map.set(product.id, product);
  }
  return map;
}

function sameCopy(left, right) {
  return APPROVED_COPY_FIELDS.every((field) => left[field] === right[field]);
}

/** Detect accidental or unreviewed edits to a serialized copy manifest. */
function assertManifestIntegrity(manifest) {
  if (manifest?.schemaVersion !== 1 || manifest.shopDomain !== FUTURE_LIGHT_SHOP_DOMAIN ||
      typeof manifest.apiVersion !== "string" || !manifest.apiVersion ||
      !Array.isArray(manifest.products) || !manifest.sourceSnapshot ||
      !Number.isInteger(manifest.sourceSnapshot.productCount) ||
      manifest.sourceSnapshot.productCount < manifest.products.length ||
      !manifest.scope || !["full-catalog", "bounded-pilot"].includes(manifest.scope.type) ||
      !Array.isArray(manifest.scope.productIds) || manifest.scope.productIds.length !== manifest.products.length ||
      !DIGEST.test(manifest.sourceSnapshot.sha256 || "") ||
      !DIGEST.test(manifest.manifestFingerprint || "")) {
    throw new Error("Invalid or wrong-store approved copy manifest");
  }
  const { manifestFingerprint, ...payload } = manifest;
  if (sha256(payload) !== manifestFingerprint) {
    throw new Error("Approved copy manifest fingerprint mismatch; the copy decisions must be re-reviewed");
  }
  const productIds = new Set();
  for (let index = 0; index < manifest.products.length; index += 1) {
    const row = manifest.products[index];
    requireText(row?.productId, "Manifest product ID");
    if (productIds.has(row.productId)) throw new Error(`Manifest contains duplicate product ${row.productId}`);
    if (manifest.scope.productIds[index] !== row.productId) throw new Error("Manifest scope IDs do not exactly match its reviewed product rows");
    productIds.add(row.productId);
    if (!new Set(["approved_keep", "needs_rewrite", "held"]).has(row.decision)) {
      throw new Error(`Manifest contains an invalid copy decision for ${row.productId}`);
    }
    if (typeof row.status !== "string" || !row.status || !row.beforeImage ||
        sha256(row.beforeImage) !== row.beforeImageSha256) {
      throw new Error(`Manifest preimage is invalid for ${row.productId}`);
    }
    if (PROTECTED_DECISIONS.has(row.decision) && (row.proposal !== undefined || row.claimLedger !== undefined)) {
      throw new Error(`${row.decision} product ${row.productId} cannot contain proposed copy fields`);
    }
    if (row.decision === "needs_rewrite" &&
        (!row.proposal || typeof row.proposal !== "object" || Array.isArray(row.proposal) ||
         Object.keys(row.proposal).length === 0 || !Array.isArray(row.claimLedger) || row.claimLedger.length === 0)) {
      throw new Error(`Rewritten product ${row.productId} has no reviewed copy proposal or claim ledger`);
    }
  }
  if (new Set(manifest.scope.productIds).size !== manifest.scope.productIds.length) {
    throw new Error("Manifest scope contains duplicate product IDs");
  }
  if ((manifest.scope.type === "full-catalog" && manifest.scope.productIds.length !== manifest.sourceSnapshot.productCount) ||
      (manifest.scope.type === "bounded-pilot" &&
       (manifest.scope.productIds.length !== FUTURE_LIGHT_COPY_PILOT_PRODUCT_COUNT ||
        manifest.scope.productIds.length >= manifest.sourceSnapshot.productCount))) {
    throw new Error("Manifest scope type does not match its declared source-catalog size");
  }
  return true;
}

/** Refuse all writes unless the live preimage exactly matches the frozen manifest. */
export function assertFutureLightCopyPreimage(manifest, liveProducts) {
  assertManifestIntegrity(manifest);
  const live = indexUniqueProducts(liveProducts, "Live preimage");
  if (live.size !== manifest.products.length) throw new Error("Live preimage product count does not match the frozen manifest");
  for (const row of manifest.products) {
    const product = live.get(row.productId);
    if (!product) throw new Error(`Live preimage is missing product ${row.productId}`);
    if (product.status !== row.status) throw new Error(`Live product status changed since snapshot: ${row.productId}`);
    const current = copyValues(product);
    if (sha256(current) !== row.beforeImageSha256 || !sameCopy(current, row.beforeImage)) {
      throw new Error(`Live copy preimage changed since approval: ${row.productId}`);
    }
  }
  return true;
}

/** Validate a write batch against only exact, reviewed needs_rewrite proposals. */
export function assertFutureLightApprovedCopyWrites(manifest, writes) {
  assertManifestIntegrity(manifest);
  if (!Array.isArray(writes)) throw new TypeError("Copy writes must be an array");
  const approved = new Map(manifest.products.map((row) => [row.productId, row]));
  const seen = new Set();
  for (const write of writes) {
    const productId = requireText(write?.productId, "Copy write product ID");
    if (seen.has(productId)) throw new Error(`Duplicate copy write for ${productId}`);
    seen.add(productId);
    const row = approved.get(productId);
    if (!row) throw new Error(`Copy write references a product outside the approved manifest: ${productId}`);
    if (row.decision !== "needs_rewrite") {
      throw new Error(`Copy write is forbidden for ${row.decision} product ${productId}`);
    }
    if (!write.fields || typeof write.fields !== "object" || Array.isArray(write.fields)) {
      throw new TypeError(`Copy write fields for ${productId} must be an object`);
    }
    const fields = Object.keys(write.fields);
    if (fields.length === 0) throw new Error(`Copy write for ${productId} has no fields`);
    for (const field of fields) {
      if (!APPROVED_COPY_FIELDS.includes(field) || !Object.hasOwn(row.proposal, field)) {
        throw new Error(`Copy write field ${field} was not approved for ${productId}`);
      }
      if (write.fields[field] !== row.proposal[field]) {
        throw new Error(`Copy write value for ${productId}.${field} differs from the approved proposal`);
      }
    }
  }
  return true;
}

/** Verify exact copy readback for every product, including byte-for-byte keep/held records. */
export function assertFutureLightCopyReadback(manifest, liveProducts) {
  assertManifestIntegrity(manifest);
  const live = indexUniqueProducts(liveProducts, "Live copy readback");
  if (live.size !== manifest.products.length) throw new Error("Live copy readback count does not match the frozen manifest");
  for (const row of manifest.products) {
    const product = live.get(row.productId);
    if (!product) throw new Error(`Live copy readback is missing ${row.productId}`);
    if (product.status !== row.status) throw new Error(`Product status changed during content release: ${row.productId}`);
    const actual = copyValues(product);
    const expected = { ...row.beforeImage, ...(row.proposal || {}) };
    if (!sameCopy(actual, expected)) throw new Error(`Exact copy readback mismatch for ${row.productId}`);
  }
  return true;
}
