const COMPLETE_BULK_CONNECTION = Object.freeze({ hasNextPage: false, endCursor: null });

export function parseShopifyBulkJsonl(text, label = "bulk export") {
  return String(text ?? "")
    .split(/\r?\n/)
    .flatMap((line, index) => {
      if (!line.trim()) return [];
      try {
        const value = JSON.parse(line);
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("line is not an object");
        }
        return [value];
      } catch (error) {
        throw new Error(`Invalid ${label} JSONL at line ${index + 1}: ${error.message}`);
      }
    });
}

function uniqueIndex(records, getId, label) {
  const map = new Map();
  for (const record of records) {
    const id = getId(record);
    if (typeof id !== "string" || !id)
      throw new Error(`${label} record is missing its Shopify ID.`);
    if (map.has(id)) throw new Error(`Duplicate ${label} ID ${id}.`);
    map.set(id, record);
  }
  return map;
}

function assertParent(parentId, parentMap, label, childId) {
  if (typeof parentId !== "string" || !parentMap.has(parentId)) {
    throw new Error(`${label} ${childId} references missing parent ${parentId || "<missing>"}.`);
  }
}

function emptyConnection(nodes = []) {
  return {
    nodes,
    pageInfo: { ...COMPLETE_BULK_CONNECTION },
    coverageSource: "completed-shopify-bulk-query",
  };
}

/** Rebuild parent/child connections emitted as flattened Shopify Bulk JSONL lines. */
export function reconcileShopifyBulkCatalog({
  catalogRecords,
  variantMediaRecords,
  publicationRecords,
  metafieldReferenceRecords = [],
  expectedOperationCounts = {},
}) {
  for (const [key, records] of Object.entries({
    catalogRecords,
    variantMediaRecords,
    publicationRecords,
    metafieldReferenceRecords,
  })) {
    if (!Array.isArray(records)) throw new Error(`${key} must be a JSONL record array.`);
  }

  // Bulk metafield-reference connections can emit referenced Products, Variants,
  // Collections, or media as child JSONL records. Only parentless Product roots and
  // children of the appropriate Shopify parent belong to these catalog connections.
  const products = catalogRecords.filter(
    (record) => record.__typename === "Product" && !record.__parentId,
  );
  const productById = uniqueIndex(products, (record) => record.id, "Product");
  const productIds = new Set(productById.keys());
  const variants = catalogRecords.filter(
    (record) => record.__typename === "ProductVariant" && productIds.has(record.__parentId),
  );
  const productMedia = catalogRecords.filter(
    (record) =>
      ["MediaImage", "Video", "ExternalVideo", "Model3d"].includes(record.__typename) &&
      productIds.has(record.__parentId),
  );
  const metafields = catalogRecords.filter(
    (record) => record.__typename === "Metafield" && productIds.has(record.__parentId),
  );
  const collections = catalogRecords.filter(
    (record) => record.__typename === "Collection" && productIds.has(record.__parentId),
  );
  const variantById = uniqueIndex(variants, (record) => record.id, "ProductVariant");
  uniqueIndex(productMedia, (record) => record.id, "Product media");
  uniqueIndex(metafields, (record) => record.id, "Product metafield");
  uniqueIndex(
    collections,
    (record) => `${record.__parentId}:${record.id}`,
    "Product/collection membership",
  );
  const mediaByProduct = new Map(products.map(({ id }) => [id, []]));
  const metafieldsByProduct = new Map(products.map(({ id }) => [id, []]));
  const collectionsByProduct = new Map(products.map(({ id }) => [id, []]));
  const variantsByProduct = new Map(products.map(({ id }) => [id, []]));
  const metafieldById = new Map(metafields.map((metafield) => [metafield.id, metafield]));
  const referencesByMetafield = new Map(metafields.map(({ id }) => [id, []]));
  const referenceIdsByMetafield = new Map(metafields.map(({ id }) => [id, new Set()]));

  let referenceMetafieldById = new Map();
  if (metafieldReferenceRecords.length) {
    const referenceProducts = metafieldReferenceRecords.filter(
      (record) => record.__typename === "Product" && !record.__parentId,
    );
    const referenceProductById = uniqueIndex(
      referenceProducts,
      (record) => record.id,
      "Metafield-reference Product",
    );
    if (referenceProductById.size !== productById.size) {
      throw new Error(
        `Metafield-reference export cohort mismatch: ${referenceProductById.size} products versus ${productById.size} catalog products.`,
      );
    }
    for (const productId of productById.keys()) {
      if (!referenceProductById.has(productId)) {
        throw new Error(`Metafield-reference export is missing Shopify product ${productId}.`);
      }
    }
    const referenceMetafields = metafieldReferenceRecords.filter(
      (record) => record.__typename === "Metafield" && productIds.has(record.__parentId),
    );
    referenceMetafieldById = uniqueIndex(
      referenceMetafields,
      (record) => record.id,
      "Metafield-reference export Metafield",
    );
    if (referenceMetafieldById.size !== metafieldById.size) {
      throw new Error(
        `Metafield-reference export cohort mismatch: ${referenceMetafieldById.size} metafields versus ${metafieldById.size} catalog metafields.`,
      );
    }
    for (const [metafieldId, catalogMetafield] of metafieldById) {
      const referenceMetafield = referenceMetafieldById.get(metafieldId);
      if (!referenceMetafield) {
        throw new Error(`Metafield-reference export is missing Shopify metafield ${metafieldId}.`);
      }
      for (const field of ["namespace", "key", "type", "value"]) {
        if (referenceMetafield[field] !== catalogMetafield[field]) {
          throw new Error(
            `Metafield-reference export disagrees with catalog metafield ${metafieldId} on ${field}.`,
          );
        }
      }
    }
  }

  function addMetafieldReference(metafieldId, reference) {
    if (!reference || typeof reference.id !== "string" || !reference.id) return;
    const target = referencesByMetafield.get(metafieldId);
    if (!target) {
      throw new Error(
        `Metafield reference ${reference.id} points to missing metafield ${metafieldId || "<missing>"}.`,
      );
    }
    const seen = referenceIdsByMetafield.get(metafieldId);
    if (seen.has(reference.id)) return;
    seen.add(reference.id);
    const { __parentId: _parentId, ...cleanReference } = reference;
    target.push(cleanReference);
  }

  for (const reference of [...catalogRecords, ...metafieldReferenceRecords].filter((record) =>
    ["Metaobject", "TaxonomyValue"].includes(record.__typename),
  )) {
    if (!reference.__parentId) {
      throw new Error(`Metafield reference ${reference.id || "<missing>"} has no parent ID.`);
    }
    addMetafieldReference(reference.__parentId, reference);
  }

  for (const metafield of metafields) {
    const referenceMetafield = referenceMetafieldById.get(metafield.id);
    const inlineNodes = [
      ...(Array.isArray(metafield.references?.nodes) ? metafield.references.nodes : []),
      ...(Array.isArray(metafield.references?.edges)
        ? metafield.references.edges.map((edge) => edge?.node).filter(Boolean)
        : []),
      ...(metafield.reference ? [metafield.reference] : []),
      ...(Array.isArray(referenceMetafield?.references?.nodes)
        ? referenceMetafield.references.nodes
        : []),
      ...(Array.isArray(referenceMetafield?.references?.edges)
        ? referenceMetafield.references.edges.map((edge) => edge?.node).filter(Boolean)
        : []),
      ...(referenceMetafield?.reference ? [referenceMetafield.reference] : []),
    ];
    for (const reference of inlineNodes) addMetafieldReference(metafield.id, reference);

    if (metafield.type === "list.metaobject_reference") {
      let expectedIds;
      try {
        expectedIds = JSON.parse(metafield.value ?? "null");
      } catch {
        throw new Error(`Metafield ${metafield.id} has invalid list.metaobject_reference JSON.`);
      }
      if (!Array.isArray(expectedIds) || expectedIds.some((id) => typeof id !== "string" || !id)) {
        throw new Error(`Metafield ${metafield.id} has an invalid metaobject reference list.`);
      }
      const actualIds = [...referenceIdsByMetafield.get(metafield.id)];
      const sortedExpected = [...expectedIds].sort();
      const sortedActual = actualIds.sort();
      if (
        sortedExpected.length !== sortedActual.length ||
        sortedExpected.some((id, index) => id !== sortedActual[index])
      ) {
        throw new Error(
          `Metafield ${metafield.id} reference readback mismatch: value lists ${expectedIds.length}, fetched ${actualIds.length}.`,
        );
      }
    }
  }

  for (const variant of variants) {
    assertParent(variant.__parentId, productById, "ProductVariant", variant.id);
    variantsByProduct.get(variant.__parentId).push(variant);
  }
  for (const media of productMedia) {
    assertParent(media.__parentId, productById, "Product media", media.id);
    mediaByProduct.get(media.__parentId).push(media);
  }
  for (const metafield of metafields) {
    assertParent(metafield.__parentId, productById, "Product metafield", metafield.id);
    metafieldsByProduct.get(metafield.__parentId).push(metafield);
  }
  for (const collection of collections) {
    assertParent(collection.__parentId, productById, "Product collection", collection.id);
    collectionsByProduct.get(collection.__parentId).push(collection);
  }

  const variantMediaRoots = variantMediaRecords.filter(
    (record) => record.__typename === "ProductVariant",
  );
  const variantMediaRootById = uniqueIndex(
    variantMediaRoots,
    (record) => record.id,
    "Variant-media ProductVariant",
  );
  if (variantMediaRootById.size !== variantById.size) {
    throw new Error(
      `Variant/media export cohort mismatch: ${variantMediaRootById.size} variants versus ${variantById.size} catalog variants.`,
    );
  }
  for (const [variantId, mediaRoot] of variantMediaRootById) {
    const catalogVariant = variantById.get(variantId);
    const bulkProductId = mediaRoot.product?.id;
    if (!catalogVariant || bulkProductId !== catalogVariant.__parentId) {
      throw new Error(`Variant/media export parent mismatch for ${variantId}.`);
    }
  }

  const variantMediaByVariant = new Map(variants.map(({ id }) => [id, []]));
  const variantMediaNodes = variantMediaRecords.filter((record) =>
    ["MediaImage", "Video", "ExternalVideo", "Model3d"].includes(record.__typename),
  );
  uniqueIndex(
    variantMediaNodes,
    (record) => `${record.__parentId}:${record.id}`,
    "Variant media association",
  );
  for (const media of variantMediaNodes) {
    assertParent(media.__parentId, variantById, "Variant media", media.id);
    variantMediaByVariant.get(media.__parentId).push(media);
  }

  const publicationProducts = publicationRecords.filter(
    (record) => record.__typename === "Product",
  );
  const publicationProductById = uniqueIndex(
    publicationProducts,
    (record) => record.id,
    "Publication Product",
  );
  if (publicationProductById.size !== productById.size) {
    throw new Error(
      `Publication export cohort mismatch: ${publicationProductById.size} products versus ${productById.size} catalog products.`,
    );
  }
  for (const productId of productById.keys()) {
    if (!publicationProductById.has(productId)) {
      throw new Error(`Publication export is missing Shopify product ${productId}.`);
    }
  }
  const publicationsByProduct = new Map(products.map(({ id }) => [id, []]));
  const publicationNodes = publicationRecords.filter(
    (record) => record.__typename === "ResourcePublication",
  );
  for (const publication of publicationNodes) {
    assertParent(
      publication.__parentId,
      productById,
      "ResourcePublication",
      publication.id || publication.publication?.id || publication.channel?.id,
    );
    publicationsByProduct.get(publication.__parentId).push(publication);
  }

  const result = products.map((product) => {
    const productId = product.id;
    const productVariants = variantsByProduct.get(productId).map((variant) => {
      const { __parentId, ...cleanVariant } = variant;
      return { ...cleanVariant, media: emptyConnection(variantMediaByVariant.get(variant.id)) };
    });
    const { __parentId: _parentId, __typename: _typename, ...cleanProduct } = product;
    return {
      ...cleanProduct,
      variants: emptyConnection(productVariants),
      media: emptyConnection(mediaByProduct.get(productId)),
      metafields: emptyConnection(
        metafieldsByProduct.get(productId).map((metafield) => ({
          ...metafield,
          references: emptyConnection(referencesByMetafield.get(metafield.id)),
        })),
      ),
      collections: emptyConnection(collectionsByProduct.get(productId)),
      resourcePublications: emptyConnection(publicationsByProduct.get(productId)),
    };
  });

  const counts = {
    products: products.length,
    variants: variants.length,
    productMedia: productMedia.length,
    variantMediaAssociations: variantMediaNodes.length,
    productMetafields: metafields.length,
    productMetafieldReferences: [...referencesByMetafield.values()].reduce(
      (total, references) => total + references.length,
      0,
    ),
    collectionMemberships: collections.length,
    resourcePublications: publicationNodes.length,
  };
  const rootCountChecks = [
    ["catalog", expectedOperationCounts.catalogRootObjectCount, products.length],
    ["variantMedia", expectedOperationCounts.variantMediaRootObjectCount, variants.length],
    ["publications", expectedOperationCounts.publicationRootObjectCount, products.length],
    [
      "metafieldReferences",
      expectedOperationCounts.metafieldReferenceRootObjectCount,
      products.length,
    ],
  ];
  for (const [name, expected, actual] of rootCountChecks) {
    if (expected !== undefined && Number(expected) !== actual) {
      throw new Error(
        `${name} bulk root count mismatch: Shopify reported ${expected}, reconstructed ${actual}.`,
      );
    }
  }
  return { products: result, counts };
}
