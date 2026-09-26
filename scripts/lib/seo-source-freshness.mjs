import { createHash } from "node:crypto";

const SOURCE_SCHEMA = "future-light-seo-source-v1";
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

function firstPresent(value, keys) {
  for (const key of keys) {
    if (own(value, key) && value[key] !== undefined) return { present: true, key, value: value[key] };
  }
  return { present: false, value: undefined };
}

function normalizedId(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const raw = String(value);
  return raw.match(/\d+$/)?.[0] || raw;
}

function connectionItems(value) {
  if (Array.isArray(value)) return { present: true, items: value, hasNextPage: false };
  if (!value || typeof value !== "object") return { present: false, items: [], hasNextPage: false };
  if (Array.isArray(value.nodes)) {
    return { present: true, items: value.nodes, hasNextPage: value.pageInfo?.hasNextPage === true };
  }
  if (Array.isArray(value.edges)) {
    return {
      present: true,
      items: value.edges.map((edge) => edge?.node).filter(Boolean),
      hasNextPage: value.pageInfo?.hasNextPage === true,
    };
  }
  return { present: false, items: [], hasNextPage: false };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function digest(value) {
  return `${SOURCE_SCHEMA}:sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;
}

function addIfPresent(target, key, result, transform = (value) => value) {
  if (result.present) target[key] = transform(result.value);
}

function selectedOptions(variant, productOptions) {
  if (Array.isArray(variant?.selectedOptions)) {
    return variant.selectedOptions.map((option) => ({
      name: String(option?.name ?? ""),
      value: String(option?.value ?? ""),
    }));
  }
  const output = [];
  for (let index = 1; index <= 3; index += 1) {
    const key = `option${index}`;
    if (!own(variant, key) || variant[key] === null || variant[key] === undefined || variant[key] === "") continue;
    output.push({
      name: String(productOptions[index - 1]?.name || `Option ${index}`),
      value: String(variant[key]),
    });
  }
  return output;
}

function mediaReference(value) {
  if (!value || typeof value !== "object") return null;
  const image = value.image && typeof value.image === "object" ? value.image : value;
  const result = {};
  addIfPresent(result, "id", firstPresent(image, ["id", "mediaId"]), normalizedId);
  addIfPresent(result, "url", firstPresent(image, ["url", "src", "originalSrc"]), String);
  addIfPresent(result, "alt", firstPresent(image, ["altText", "alt"]), String);
  addIfPresent(result, "contentType", firstPresent(value, ["mediaContentType", "contentType"]), String);
  return Object.keys(result).length ? result : null;
}

function sourceProjection(product) {
  const identity = {};
  addIfPresent(identity, "productId", firstPresent(product, ["id", "productId", "legacyResourceId"]), normalizedId);
  addIfPresent(identity, "handle", firstPresent(product, ["handle"]), String);

  const editorial = {};
  addIfPresent(editorial, "title", firstPresent(product, ["title"]), (value) => String(value ?? ""));
  addIfPresent(editorial, "body", firstPresent(product, ["descriptionHtml", "body_html", "body"]), (value) => String(value ?? ""));

  const typed = {};
  addIfPresent(typed, "productType", firstPresent(product, ["productType", "product_type"]), (value) => String(value ?? ""));

  const optionsResult = firstPresent(product, ["options"]);
  const productOptions = Array.isArray(optionsResult.value) ? optionsResult.value : [];
  const options = optionsResult.present
    ? productOptions.map((option) => {
        const normalized = {};
        addIfPresent(normalized, "name", firstPresent(option, ["name"]), String);
        addIfPresent(normalized, "position", firstPresent(option, ["position"]), Number);
        addIfPresent(normalized, "values", firstPresent(option, ["values"]), (values) =>
          Array.isArray(values) ? values.map((value) => String(value ?? "")) : values,
        );
        return normalized;
      })
    : undefined;

  const variantsResult = firstPresent(product, ["variants"]);
  const variantsConnection = connectionItems(variantsResult.value);
  const variants = variantsResult.present && variantsConnection.present
    ? variantsConnection.items.map((variant) => {
        const normalized = {};
        addIfPresent(normalized, "id", firstPresent(variant, ["id", "variantId"]), normalizedId);
        addIfPresent(normalized, "title", firstPresent(variant, ["title"]), (value) => String(value ?? ""));
        addIfPresent(normalized, "sku", firstPresent(variant, ["sku"]), (value) => String(value ?? ""));
        normalized.options = selectedOptions(variant, productOptions);
        const imageResult = firstPresent(variant, ["image", "featured_image", "featuredImage"]);
        const image = mediaReference(imageResult.value);
        if (image) normalized.image = image;
        return normalized;
      })
    : undefined;

  const imageAssociations = new Map();
  for (const variant of variants || []) {
    if (!variant.id || !variant.image) continue;
    const key = variant.image.id ? `id:${variant.image.id}` : variant.image.url ? `url:${variant.image.url}` : "";
    if (!key) continue;
    if (!imageAssociations.has(key)) imageAssociations.set(key, new Set());
    imageAssociations.get(key).add(variant.id);
  }
  const media = {};
  const incomplete = [];
  if (variantsConnection.hasNextPage) incomplete.push("variants");
  for (const field of ["images", "media"]) {
    const source = firstPresent(product, [field]);
    if (!source.present) continue;
    const connection = connectionItems(source.value);
    if (connection.hasNextPage) incomplete.push(field);
    if (!connection.present) continue;
    media[field] = connection.items.map((entry) => {
      const normalized = mediaReference(entry) || {};
      const key = normalized.id ? `id:${normalized.id}` : normalized.url ? `url:${normalized.url}` : "";
      const variantIds = new Set();
      const rawVariantIds = firstPresent(entry, ["variant_ids", "variantIds"]);
      if (rawVariantIds.present && Array.isArray(rawVariantIds.value)) {
        for (const id of rawVariantIds.value) {
          const normalizedVariantId = normalizedId(id);
          if (normalizedVariantId) variantIds.add(normalizedVariantId);
        }
      }
      for (const id of imageAssociations.get(key) || []) variantIds.add(id);
      if (variantIds.size) normalized.variantIds = [...variantIds].sort();
      return normalized;
    });
  }
  return {
    projection: {
      schema: SOURCE_SCHEMA,
      ...(Object.keys(identity).length ? { identity } : {}),
      ...(Object.keys(editorial).length ? { editorial } : {}),
      ...(Object.keys(typed).length ? { typed } : {}),
      ...(options !== undefined ? { options } : {}),
      ...(variants !== undefined ? { variants } : {}),
      ...(Object.keys(media).length ? { media } : {}),
    },
    incomplete,
  };
}

export function fingerprintSeoSource(product) {
  const { projection, incomplete } = sourceProjection(product);
  if (incomplete.length) {
    throw new Error(`SEO source preimage is incomplete (${incomplete.join(", ")}); refusing to fingerprint a partial catalog record`);
  }
  return {
    sourceFingerprint: digest(projection),
    sourceStructureFingerprint: digest({
      schema: projection.schema,
      ...(projection.identity ? { identity: projection.identity } : {}),
      ...(projection.typed ? { typed: projection.typed } : {}),
      ...(own(projection, "options") ? { options: projection.options } : {}),
      ...(own(projection, "variants") ? { variants: projection.variants } : {}),
      ...(own(projection, "media") ? { media: projection.media } : {}),
    }),
  };
}

function productSourceTitle(product) {
  const value = firstPresent(product, ["title"]);
  return value.present ? String(value.value ?? "") : "";
}

function productSourceBody(product) {
  const value = firstPresent(product, ["descriptionHtml", "body_html", "body"]);
  return value.present ? String(value.value ?? "") : "";
}

function stableProductId(value) {
  const raw = String(value?.legacyResourceId ?? value?.id ?? value?.productId ?? "");
  return raw.match(/\d+$/)?.[0] || raw;
}

function timestampValue(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Combine exact live editorial fields with variant/options/media fields from
 * the release catalog snapshot. Their Shopify updatedAt timestamps must agree,
 * except for a precisely verified SEO write recorded by this manifest.
 */
export function bindSeoSourceSnapshot(liveProducts, catalogProducts, manifestItems = []) {
  const catalogById = new Map((catalogProducts || []).map((product) => [stableProductId(product), product]));
  const itemById = new Map((manifestItems || []).map((item) => [stableProductId(item), item]));
  const itemByHandle = new Map((manifestItems || []).map((item) => [String(item?.handle || ""), item]));

  return (liveProducts || []).map((liveProduct) => {
    const id = stableProductId(liveProduct);
    const catalogProduct = catalogById.get(id);
    if (!catalogProduct) {
      throw new Error(`SEO source catalog is missing current product ${liveProduct.handle}; refusing to fingerprint incomplete variant/media data`);
    }
    const prior = itemById.get(id) || itemByHandle.get(String(liveProduct?.handle || ""));
    const liveUpdatedAt = timestampValue(liveProduct.updatedAt);
    const catalogUpdatedAt = timestampValue(catalogProduct.updated_at ?? catalogProduct.updatedAt);
    const verifiedCurrentWrite = prior?.status === "verified" &&
      timestampValue(prior.verifiedSourceUpdatedAt) !== null &&
      timestampValue(prior.verifiedSourceUpdatedAt) === liveUpdatedAt &&
      liveProduct.title === prior.desired?.title &&
      liveProduct.descriptionHtml === prior.desired?.descriptionHtml;

    if (!verifiedCurrentWrite && (liveUpdatedAt === null || catalogUpdatedAt === null || liveUpdatedAt !== catalogUpdatedAt)) {
      throw new Error(`SEO source snapshot is stale for ${liveProduct.handle}; Shopify and local catalog update times do not match`);
    }

    const bound = { ...liveProduct };
    for (const key of ["options", "variants", "images", "media"]) {
      if (own(catalogProduct, key)) bound[key] = catalogProduct[key];
    }
    return bound;
  });
}

/**
 * Bind approved SEO to the exact source preimage used to create it. A verified
 * applied item may have changed only title/body to its approved output; in that
 * case the immutable product structure must still match the captured preimage.
 */
export function auditSeoManifestSourceFreshness(products, manifestItems) {
  const byHandle = new Map();
  const byProductId = new Map();
  const seenHandles = new Set();
  const seenProductIds = new Set();
  const issues = [];
  for (const item of manifestItems || []) {
    if (item?.handle) {
      const handle = String(item.handle);
      if (seenHandles.has(handle)) issues.push({ handle, reason: "duplicate-manifest-handle" });
      seenHandles.add(handle);
      byHandle.set(handle, item);
    }
    const productId = stableProductId(item);
    if (productId) {
      if (seenProductIds.has(productId)) {
        issues.push({ handle: String(item?.handle || productId), reason: "duplicate-manifest-product-id" });
      }
      seenProductIds.add(productId);
      byProductId.set(productId, item);
    }
  }

  for (const product of products || []) {
    const handle = String(product?.handle || "");
    const productId = stableProductId(product);
    const item = (productId && byProductId.get(productId)) || byHandle.get(handle);
    if (!item) continue;
    const itemProductId = stableProductId(item);
    const sourceTitle = typeof item.sourceTitle === "string" ? item.sourceTitle : "";
    const liveTitle = productSourceTitle(product);
    const currentHandle = handle || String(item.handle || "unknown");
    const addIssue = (reason) => issues.push({ handle: currentHandle, reason, sourceTitle, liveTitle });

    if (!sourceTitle || !liveTitle) {
      addIssue(!sourceTitle ? "missing-source-title" : "missing-live-title");
      continue;
    }
    if (itemProductId && productId && itemProductId !== productId) {
      addIssue("product-id-mismatch");
      continue;
    }
    if (typeof item.sourceFingerprint !== "string" || !item.sourceFingerprint) {
      addIssue("missing-source-fingerprint");
      continue;
    }
    if (typeof item.sourceStructureFingerprint !== "string" || !item.sourceStructureFingerprint) {
      addIssue("missing-source-structure-fingerprint");
      continue;
    }

    let current;
    try {
      current = fingerprintSeoSource(product);
    } catch (error) {
      addIssue(`incomplete-source-preimage:${String(error?.message || error).replace(/^.*\(([^)]+)\).*$/, "$1")}`);
      continue;
    }
    if (current.sourceFingerprint === item.sourceFingerprint) continue;

    const desiredTitle = typeof item.desired?.title === "string" ? item.desired.title : "";
    const desiredBody = typeof item.desired?.descriptionHtml === "string" ? item.desired.descriptionHtml : "";
    const verifiedAppliedCopy = item.status === "verified" &&
      desiredTitle && desiredBody &&
      liveTitle === desiredTitle && productSourceBody(product) === desiredBody &&
      current.sourceStructureFingerprint === item.sourceStructureFingerprint;
    if (verifiedAppliedCopy) continue;
    addIssue(current.sourceStructureFingerprint !== item.sourceStructureFingerprint
      ? "stale-source-fingerprint"
      : item.status === "verified" && liveTitle === desiredTitle
        ? "stale-source-fingerprint"
      : sourceTitle !== liveTitle
        ? "stale-source-title"
        : "stale-source-fingerprint");
  }
  return { checked: (products || []).length, issues };
}

export function assertSeoManifestSourceFreshness(products, manifestItems) {
  const audit = auditSeoManifestSourceFreshness(products, manifestItems);
  if (audit.issues.length) {
    const examples = audit.issues
      .slice(0, 8)
      .map(({ handle, reason }) => `${handle}:${reason}`)
      .join(" | ");
    throw new Error(
      `SEO manifest source preimage is missing or stale for ${audit.issues.length}/${audit.checked} catalog product(s); refusing to rebuild storefront SEO. First: ${examples}`,
    );
  }
  return audit;
}
