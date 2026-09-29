import {
  assertFutureLightApprovedCopyWrites,
  assertFutureLightCopyPreimage,
} from "./future-light-approved-copy-manifest.mjs";

const COPY_FIELDS = Object.freeze([
  "title",
  "descriptionHtml",
  "seoTitle",
  "seoDescription",
]);

function requireProductId(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be an exact Shopify product ID`);
  }
  return value;
}

function indexProducts(products, label) {
  if (!Array.isArray(products)) throw new TypeError(`${label} must be an array`);
  const byId = new Map();
  for (const product of products) {
    const id = requireProductId(product?.id, `${label} product ID`);
    if (byId.has(id)) throw new Error(`${label} contains duplicate product ${id}`);
    byId.set(id, product);
  }
  return byId;
}

export function exactSeoCopyFromProduct(product) {
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

export function sameExactSeoCopy(left, right) {
  return COPY_FIELDS.every((field) => left?.[field] === right?.[field]);
}

export function needsExactSeoCopyWrite(item, liveProduct) {
  if (!liveProduct) throw new Error(`Live product is missing for ${item?.productId || "unknown ID"}`);
  if (liveProduct.id !== item?.productId || liveProduct.handle !== item?.handle) {
    throw new Error(`Live product identity mismatch for ${item?.productId || "unknown ID"}`);
  }
  return !sameExactSeoCopy(exactSeoCopyFromProduct(liveProduct), item.desired);
}

export function assertExactSeoCopyReadback(item, liveProduct) {
  if (!liveProduct) throw new Error(`Exact copy readback is missing ${item?.productId || "unknown ID"}`);
  if (liveProduct.id !== item?.productId || liveProduct.handle !== item?.handle) {
    throw new Error(`Exact copy readback identity mismatch for ${item?.productId || "unknown ID"}`);
  }
  if (!sameExactSeoCopy(exactSeoCopyFromProduct(liveProduct), item.desired)) {
    throw new Error(`Exact copy readback mismatch for ${item.productId}`);
  }
  return true;
}

export function assertFutureLightSeoApprovalState(approvalManifest, liveProducts) {
  if (!approvalManifest) throw new Error("Missing exact approved-copy manifest");
  if (!Array.isArray(approvalManifest.products) || approvalManifest.products.length === 0) {
    throw new Error("Approved-copy manifest has no reviewed product IDs");
  }
  const liveById = indexProducts(liveProducts, "Live catalog");
  const approvedIds = new Set(approvalManifest.products.map((row) =>
    requireProductId(row?.productId, "Approved manifest product ID"),
  ));
  const scopedProducts = approvalManifest.scope?.type === "full-catalog"
    ? liveProducts
    : [...approvedIds].map((id) => liveById.get(id)).filter(Boolean);
  const approvedById = new Map(approvalManifest.products.map((row) => [row.productId, row]));

  // Rebuild only the frozen copy fields to validate manifest integrity and the
  // exact original preimage. The live values are checked separately below so a
  // resumed run may contain already-applied, exact approved rewrites.
  const frozenPreimage = scopedProducts.map((product) => {
    const approved = approvedById.get(product.id);
    if (!approved) throw new Error(`Live catalog contains unapproved product ${product.id}`);
    return {
      ...product,
      title: approved.beforeImage?.title,
      descriptionHtml: approved.beforeImage?.descriptionHtml,
      seo: {
        ...product.seo,
        title: approved.beforeImage?.seoTitle,
        description: approved.beforeImage?.seoDescription,
      },
    };
  });
  assertFutureLightCopyPreimage(approvalManifest, frozenPreimage);

  for (const approved of approvalManifest.products) {
    const product = liveById.get(approved.productId);
    if (!product) continue; // The preimage assertion above reports missing scope IDs.
    const actual = exactSeoCopyFromProduct(product);
    const beforeImage = approved.beforeImage;
    const exactApprovedPostimage = approved.decision === "needs_rewrite" &&
      sameExactSeoCopy(actual, { ...beforeImage, ...approved.proposal });
    if (!sameExactSeoCopy(actual, beforeImage) && !exactApprovedPostimage) {
      throw new Error(`Live copy is neither the frozen preimage nor exact approved rewrite for ${approved.productId}`);
    }
  }
  return true;
}

export function authorizeFutureLightSeoItems({
  approvalManifest,
  liveProducts,
  expectedProducts,
  items,
} = {}) {
  assertFutureLightSeoApprovalState(approvalManifest, liveProducts);
  if (!Array.isArray(items)) throw new TypeError("SEO plan items must be an array");

  const liveById = indexProducts(liveProducts, "Live catalog");
  const expectedById = indexProducts(expectedProducts, "Expected SEO scope");
  const approvedById = new Map(approvalManifest.products.map((row) => [row.productId, row]));
  const seen = new Set();
  const writes = [];
  const authorizedItems = items.map((item) => {
    const productId = requireProductId(item?.productId, "SEO plan product ID");
    if (seen.has(productId)) throw new Error(`SEO plan contains duplicate product ${productId}`);
    seen.add(productId);
    if (!expectedById.has(productId)) {
      throw new Error(`SEO plan product ${productId} is outside the exact execution scope`);
    }

    const liveProduct = liveById.get(productId);
    if (!liveProduct) throw new Error(`Live product is missing for SEO plan ${productId}`);
    if (typeof item.handle !== "string" || item.handle !== liveProduct.handle) {
      throw new Error(`SEO plan handle does not match live product ${productId}`);
    }

    const approved = approvedById.get(productId);
    if (!approved) throw new Error(`No approved-copy decision for exact product ID ${productId}`);
    const sourceCopy = approved.beforeImage;
    if (approved.decision === "needs_rewrite") {
      for (const [field, value] of Object.entries(approved.proposal || {})) {
        if (!Object.hasOwn(item.desired || {}, field) || item.desired[field] !== value) {
          throw new Error(`SEO proposal ${field} for ${productId} differs from the exact approved value`);
        }
      }
      const approvedWrite = {
        productId,
        fields: { ...approved.proposal },
      };
      writes.push(approvedWrite);
      return {
        ...item,
        desired: { ...sourceCopy, ...approved.proposal },
        approvalDecision: approved.decision,
        approvedWrite,
      };
    }

    return {
      ...item,
      desired: { ...sourceCopy },
      approvalDecision: approved.decision,
      approvedWrite: null,
    };
  });

  const missing = [...expectedById.keys()].filter((id) => !seen.has(id));
  if (missing.length) {
    throw new Error(`SEO plan is missing ${missing.length} product(s) from its exact execution scope`);
  }
  assertFutureLightApprovedCopyWrites(approvalManifest, writes);
  return authorizedItems;
}

export function assertFutureLightSeoBatchApproval(approvalManifest, items) {
  if (!Array.isArray(items)) throw new TypeError("SEO write batch must be an array");
  const approvedById = new Map(approvalManifest?.products?.map((row) => [row.productId, row]) || []);
  const writes = items.map((item) => {
    if (item?.approvalDecision !== "needs_rewrite" || !item.approvedWrite) {
      throw new Error(`SEO mutation is forbidden for unapproved product ${item?.productId || "unknown ID"}`);
    }
    const productId = requireProductId(item.productId, "SEO write product ID");
    const approved = approvedById.get(productId);
    if (!approved || approved.decision !== "needs_rewrite") {
      throw new Error(`SEO mutation is not approved for exact product ID ${productId}`);
    }
    const expected = { ...approved.beforeImage, ...approved.proposal };
    if (!sameExactSeoCopy(item.desired, expected)) {
      throw new Error(`SEO mutation copy for ${productId} differs from the exact approved proposal`);
    }
    if (item.approvedWrite.productId !== productId) {
      throw new Error(`SEO mutation identity differs from its approved product ID ${productId}`);
    }
    const writeFields = item.approvedWrite.fields || {};
    const proposalFields = approved.proposal || {};
    const fieldsMatch = Object.keys(writeFields).length === Object.keys(proposalFields).length &&
      Object.entries(proposalFields).every(([field, value]) => writeFields[field] === value);
    if (!fieldsMatch) {
      throw new Error(`SEO mutation fields for ${productId} differ from the exact approved proposal`);
    }
    return item.approvedWrite;
  });
  return assertFutureLightApprovedCopyWrites(approvalManifest, writes);
}
