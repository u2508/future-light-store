const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function definitionKeyOf(metafield, label) {
  const namespace = requireNonEmptyString(
    metafield?.definitionKey?.namespace,
    `${label}.definitionKey.namespace`,
  );
  const key = requireNonEmptyString(metafield?.definitionKey?.key, `${label}.definitionKey.key`);
  return `${namespace}.${key}`;
}

function validateExpectedProducts(expectedProducts) {
  if (!Array.isArray(expectedProducts)) {
    throw new TypeError("expectedProducts must be an array");
  }

  const seenProducts = new Set();
  for (const [productIndex, product] of expectedProducts.entries()) {
    const label = `expectedProducts[${productIndex}]`;
    const productId = requireNonEmptyString(product?.productId, `${label}.productId`);
    requireNonEmptyString(product?.categoryId, `${label}.categoryId`);
    if (seenProducts.has(productId))
      throw new TypeError(`Duplicate expected productId: ${productId}`);
    seenProducts.add(productId);

    if (product.metafields === undefined) continue;
    if (!Array.isArray(product.metafields))
      throw new TypeError(`${label}.metafields must be an array`);
    const seenKeys = new Set();
    for (const [metafieldIndex, metafield] of product.metafields.entries()) {
      const metafieldLabel = `${label}.metafields[${metafieldIndex}]`;
      const definitionKey = definitionKeyOf(metafield, metafieldLabel);
      if (seenKeys.has(definitionKey)) {
        throw new TypeError(
          `Duplicate expected metafield definition key ${definitionKey} for ${productId}`,
        );
      }
      seenKeys.add(definitionKey);

      const hasCanonicalValue = own(metafield, "canonicalValue");
      const hasCanonicalReference = own(metafield, "canonicalReference");
      if (hasCanonicalValue === hasCanonicalReference) {
        throw new TypeError(
          `${metafieldLabel} must provide exactly one of canonicalValue or canonicalReference`,
        );
      }
      if (hasCanonicalValue && typeof metafield.canonicalValue !== "string") {
        throw new TypeError(`${metafieldLabel}.canonicalValue must be a string`);
      }
      if (own(metafield, "expectedType")) {
        requireNonEmptyString(metafield.expectedType, `${metafieldLabel}.expectedType`);
      }
      if (hasCanonicalReference) {
        const references = Array.isArray(metafield.canonicalReference)
          ? metafield.canonicalReference
          : [metafield.canonicalReference];
        if (references.length === 0)
          throw new TypeError(`${metafieldLabel}.canonicalReference must not be empty`);
        references.forEach((reference, index) =>
          requireNonEmptyString(reference, `${metafieldLabel}.canonicalReference[${index}]`),
        );
      }
    }
  }
}

function readReferenceIds(metafield) {
  if (Array.isArray(metafield?.references?.nodes)) {
    return metafield.references.nodes.map((node) => node?.id ?? null);
  }
  if (typeof metafield?.reference?.id === "string") return [metafield.reference.id];

  if (typeof metafield?.value === "string") {
    try {
      const parsed = JSON.parse(metafield.value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Shopify stores a single reference's GID directly in value.
    }
    return [metafield.value];
  }
  return [];
}

function actualMetafieldSummary(metafield) {
  return {
    definitionKey: `${metafield?.namespace ?? ""}.${metafield?.key ?? ""}`,
    type: metafield?.type ?? null,
    value: metafield?.value ?? null,
    referenceIds: readReferenceIds(metafield),
  };
}

function expectedMetafieldSummary(metafield) {
  const summary = own(metafield, "canonicalValue")
    ? { value: metafield.canonicalValue }
    : {
        referenceIds: Array.isArray(metafield.canonicalReference)
          ? [...metafield.canonicalReference]
          : [metafield.canonicalReference],
      };
  if (own(metafield, "expectedType")) summary.type = metafield.expectedType;
  return summary;
}

function addCheck(checks, check) {
  checks.push(check);
}

/**
 * Compare a frozen expected Shopify product/category/metafield snapshot with
 * Shopify-shaped readback fixtures. This function performs no I/O and does not
 * mutate either input.
 *
 * Expected metafields have `definitionKey: { namespace, key }` and exactly one
 * of `canonicalValue` (an exact Shopify value string) or `canonicalReference`
 * (one GID or an ordered list of GIDs). `expectedType` is optional; when
 * supplied, it is compared exactly with the readback metafield type. Unknown
 * readback metafields are ignored unless their namespace or full definition key
 * is explicitly managed, or `fullMetafieldSnapshot` is true. Readback products
 * use `id`, `category.id`, and `metafields` with Shopify's
 * namespace/key/value/reference fields.
 */
export function validateShopifyCategoryMetafieldReadback({
  expectedProducts,
  readbackProducts,
  managedMetafieldNamespaces = [],
  managedMetafieldDefinitionKeys = [],
  fullMetafieldSnapshot = false,
}) {
  validateExpectedProducts(expectedProducts);
  if (!Array.isArray(readbackProducts)) throw new TypeError("readbackProducts must be an array");
  if (!Array.isArray(managedMetafieldNamespaces)) {
    throw new TypeError("managedMetafieldNamespaces must be an array");
  }
  if (!Array.isArray(managedMetafieldDefinitionKeys)) {
    throw new TypeError("managedMetafieldDefinitionKeys must be an array");
  }
  if (typeof fullMetafieldSnapshot !== "boolean") {
    throw new TypeError("fullMetafieldSnapshot must be a boolean");
  }

  const managedNamespaces = new Set(
    managedMetafieldNamespaces.map((namespace, index) =>
      requireNonEmptyString(namespace, `managedMetafieldNamespaces[${index}]`),
    ),
  );
  const managedDefinitionKeys = new Set(
    managedMetafieldDefinitionKeys.map((definitionKey, index) =>
      requireNonEmptyString(definitionKey, `managedMetafieldDefinitionKeys[${index}]`),
    ),
  );

  const checks = [];
  const expectedById = new Map(expectedProducts.map((product) => [product.productId, product]));
  const readbackById = new Map();

  for (const product of readbackProducts) {
    const productId = typeof product?.id === "string" ? product.id : null;
    const rows = readbackById.get(productId) || [];
    rows.push(product);
    readbackById.set(productId, rows);
  }

  for (const expected of expectedProducts) {
    const actualRows = readbackById.get(expected.productId) || [];
    if (actualRows.length === 0) {
      addCheck(checks, {
        status: "missing",
        type: "product",
        productId: expected.productId,
        expected: { productId: expected.productId },
        actual: null,
      });
      continue;
    }
    if (actualRows.length > 1) {
      addCheck(checks, {
        status: "mismatch",
        type: "product",
        productId: expected.productId,
        expected: { productId: expected.productId, count: 1 },
        actual: { count: actualRows.length },
        reason: "duplicate-product-readback",
      });
      continue;
    }

    const actualProduct = actualRows[0];
    const actualCategoryId = actualProduct?.category?.id ?? null;
    const categoryStatus =
      actualCategoryId === null
        ? "missing"
        : actualCategoryId === expected.categoryId
          ? "match"
          : "mismatch";
    addCheck(checks, {
      status: categoryStatus,
      type: "category",
      productId: expected.productId,
      expected: { categoryId: expected.categoryId },
      actual: actualCategoryId === null ? null : { categoryId: actualCategoryId },
    });

    const expectedMetafields = expected.metafields || [];
    const expectedKeys = new Set(
      expectedMetafields.map((metafield) => definitionKeyOf(metafield, "expected metafield")),
    );
    const actualMetafields = Array.isArray(actualProduct?.metafields)
      ? actualProduct.metafields
      : [];
    const actualByKey = new Map();
    for (const metafield of actualMetafields) {
      const key = `${metafield?.namespace ?? ""}.${metafield?.key ?? ""}`;
      const rows = actualByKey.get(key) || [];
      rows.push(metafield);
      actualByKey.set(key, rows);
    }

    for (const expectedMetafield of expectedMetafields) {
      const definitionKey = definitionKeyOf(expectedMetafield, "expected metafield");
      const actualRowsForKey = actualByKey.get(definitionKey) || [];
      const common = {
        type: "metafield",
        productId: expected.productId,
        definitionKey,
        expected: expectedMetafieldSummary(expectedMetafield),
      };
      if (actualRowsForKey.length === 0) {
        addCheck(checks, { ...common, status: "missing", actual: null });
        continue;
      }
      if (actualRowsForKey.length > 1) {
        addCheck(checks, {
          ...common,
          status: "mismatch",
          actual: actualRowsForKey.map(actualMetafieldSummary),
          reason: "duplicate-metafield-readback",
        });
        continue;
      }

      const actual = actualRowsForKey[0];
      const isMatch = own(expectedMetafield, "canonicalValue")
        ? actual?.value === expectedMetafield.canonicalValue
        : JSON.stringify(readReferenceIds(actual)) ===
          JSON.stringify(
            Array.isArray(expectedMetafield.canonicalReference)
              ? expectedMetafield.canonicalReference
              : [expectedMetafield.canonicalReference],
          );
      const typeMatches =
        !own(expectedMetafield, "expectedType") || actual?.type === expectedMetafield.expectedType;
      addCheck(checks, {
        ...common,
        status: isMatch && typeMatches ? "match" : "mismatch",
        actual: actualMetafieldSummary(actual),
        ...(!typeMatches ? { reason: "type-mismatch" } : {}),
      });
    }

    for (const [definitionKey, rows] of actualByKey) {
      if (expectedKeys.has(definitionKey)) continue;
      const namespace = rows[0]?.namespace;
      if (
        !fullMetafieldSnapshot &&
        !managedNamespaces.has(namespace) &&
        !managedDefinitionKeys.has(definitionKey)
      ) {
        continue;
      }
      for (const actual of rows) {
        addCheck(checks, {
          status: "unexpected",
          type: "metafield",
          productId: expected.productId,
          definitionKey,
          expected: null,
          actual: actualMetafieldSummary(actual),
        });
      }
    }
  }

  for (const [productId, rows] of readbackById) {
    if (expectedById.has(productId)) continue;
    for (const actual of rows) {
      addCheck(checks, {
        status: "unexpected",
        type: "product",
        productId,
        expected: null,
        actual: { productId: actual?.id ?? null },
      });
    }
  }

  const summary = {
    expectedProducts: expectedProducts.length,
    readbackProducts: readbackProducts.length,
    checks: checks.length,
    matched: checks.filter((check) => check.status === "match").length,
    missing: checks.filter((check) => check.status === "missing").length,
    mismatch: checks.filter((check) => check.status === "mismatch").length,
    unexpected: checks.filter((check) => check.status === "unexpected").length,
  };

  return {
    status: summary.missing || summary.mismatch || summary.unexpected ? "fail" : "pass",
    summary,
    checks,
  };
}
